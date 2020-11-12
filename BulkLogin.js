const fs = require('fs')
const WebMail = require('./WebMail')
const logger = require('./logger.js');
const { Cluster } = require('./node_modules/puppeteer-cluster/dist');
const mailLoginCfg = require('./maillogincfg.json')
const peaProxy = require('./PeaProxy.js')
const BackendServer = require('./BackendServer')

let WebMailType = {
    WebMailType126:1,
    WebMailType163:2,
    WebMailTypeUnknown:3
}

class BulkLogin {
    static LoginExecState = {
        LoginExecStateQueue:1,
        LoginExecStateExecuted:2,
    }

    constructor() {
        this.webMail =  new WebMail()
        this.webType = WebMailType.WebMailTypeUnknown
        this.mailList = [];
        this.maxLoginCountEachIp = 20;
        this.proxyEngine = null
        this.puppeteerOpt = { maxConcurrency: 2,
              timeout:120000,
                headless:false}
    }

    static webMailStateToStr(webMailState) {
        let webMailStateStr = ''
        switch(webMailState) {  
            case WebMail.WebMailState.WebMailStateUnKnown:
                webMailStateStr = '未知'
                break;
            case WebMail.WebMailState.WebMailStateAuth:
                webMailStateStr = '成功'
                break;
            case WebMail.WebMailState.WebMailStateAuthFail:
                webMailStateStr = '无法登录'
                break;
            case WebMail.WebMailState.WebMailStateAuthFurther:
                webMailStateStr = '需进一步认证'
                break;
            case WebMail.WebMailState.WebMailStateInit:
                webMailStateStr = `初始状态`
                break;
            default:
                webMailStateStr = '内部错误'
                break;
        }
        return webMailStateStr
    }
    async init(jsonCfg) {
        let mongoUrl = `mongodb://${jsonCfg.mongoCfg.ip}:${jsonCfg.mongoCfg.port}/`
        this.webMail.setupChaoJiYing(jsonCfg.chaoJiYing.user, jsonCfg.chaoJiYing.password, jsonCfg.chaoJiYing.softid);
        await this.webMail.init(false, mongoUrl)
        await this.connectProxyServer(jsonCfg)

        if (jsonCfg.mailSenderFile.webType === '126') {
            this.webType = WebMailType.WebMailType126
        }else {
            this.webType = WebMailType.WebMailType163
        }

        this.maxLoginCountEachIp = jsonCfg.maxLoginCountEachIp
        this.puppeteerOpt.maxConcurrency = jsonCfg.puppeteer.maxConcurrency
        this.puppeteerOpt.timeout = jsonCfg.puppeteer.timeout
        this.puppeteerOpt.headless = jsonCfg.puppeteer.headless
    }

    mailAccountListSet(mailAccountList) {
        this.mailList = mailAccountList;
    }

    async mailAccountLoadFromFile(filename, webType) {
        let mailfscontent = fs.readFileSync(filename, 'utf-8')
        let maillist = mailfscontent.split('\r\n')
        for (let ii = 0; ii < maillist.length; ii++) {
            let mailsplit = maillist[ii].split('----');
            if (mailsplit.length < 2) {
                logger.error(`读取信息错误 ${maillist[ii]}`)
                continue;
            }


            let addrobj = {}
            addrobj.username = mailsplit[0];
            addrobj.password = mailsplit[1];
            addrobj.execState = BulkLogin.LoginExecState.LoginExecStateQueue;
            addrobj.verifyCount = -1;
            this.mailList.push(addrobj)
        }
    }

    async validProxyIpFetch(maxRetryTimes = 3) {
        let ipLoop = 0;
        let proxyIpList = []
        let proxyIP = ''
        while (ipLoop < 10) {
            proxyIpList = await this.proxyEngine.doGetAuthenProxyIps(1);
            if (proxyIpList.length >= 1) {
                 proxyIP = `http://${proxyIpList[0].ip}:${proxyIpList[0].port}`
                 let data = await this.proxyEngine.testProxyAvailable(proxyIP)
                 if (data != null) {
                    break;
                 }
            }
            ipLoop++;
        }
        if (proxyIpList.length < 1) {
            logger.error('获取代理IP失败')
            
        }        
        return  proxyIpList

    }

    async mailAccountPreCheck() {
        let lista = this.mailList

        for (let ii = 0; ii < lista.length; ii++) {
            let checkResult
            if (this.webType == WebMailType.WebMailType126) {
                checkResult= await this.webMail.mail126NeedLoginCheck(lista[ii].username, lista[ii].password);
            } else {
                checkResult= await this.webMail.mail163NeedLoginCheck(lista[ii].username, lista[ii].password);
            }    
            if (checkResult.needCheck) {
                lista[ii].execState =  BulkLogin.LoginExecState.LoginExecStateQueue
                lista[ii].cookieState =  checkResult.cookieState
            } else {
                if (this.authReCheck && (checkResult.cookieState ==  WebMail.WebMailState.WebMailStateAuthFail || 
                    checkResult.cookieState == WebMail.WebMailState.WebMailStateAuthFurther)) {
                        lista[ii].execState =  BulkLogin.LoginExecState.LoginExecStateQueue
                        lista[ii].cookieState =  WebMail.WebMailState.WebMailStateInit
                }else {
                    lista[ii].execState =  BulkLogin.LoginExecState.LoginExecStateExecuted
                    lista[ii].cookieState = checkResult.cookieState
                }
                continue;
            }        
        }
    }

    async mailAccountsLogin(authReCheck=false) {
        let lista;
        this.authReCheck = authReCheck
        await this.mailAccountPreCheck()
        lista = this.mailList
        let loginList = []
        
        for (let ii = 0; ii < lista.length; ii++) {
            logger.info(`begin login mailAccountsLogin ${lista[ii].execState}`)
            if (lista[ii].execState == BulkLogin.LoginExecState.LoginExecStateExecuted) {
                continue;
            }

            loginList.push({ username: lista[ii].username, password: lista[ii].password, indexInList:ii})
            lista[ii].execState =  BulkLogin.LoginExecState.LoginExecStateExecuted

            if (loginList.length >= this.maxLoginCountEachIp) {
                let iplist = await this.validProxyIpFetch()
                if (iplist.length < 1) {
                    logger.error('获取代理IP失败')
                    return;
                }
                
                await this.puppeteerClusterRunLogin( `http://${iplist[0].ip}:${iplist[0].port}`, loginList, this.webType)
                // remove the screenshot files 
                
                for (let jj = 0; jj < loginList.length; jj++) {

                    try {
                        fs.unlinkSync(`./yidunpic/${loginList[jj].username}_send.png`)
                    // eslint-disable-next-line no-empty
                    }catch(e) {


                    }
                    
                }
                loginList = []
            }
        }

        if (loginList.length >= 0) {
            let iplist = await this.validProxyIpFetch()
            if (iplist.length < 1) {
                logger.error('获取代理IP失败')
                return;
            }
            
            await this.puppeteerClusterRunLogin( `http://${iplist[0].ip}:${iplist[0].port}`, loginList, this.webType)
            // remove the screenshot files 
            
            for (let jj = 0; jj < loginList.length; jj++) {

                try {
                    fs.unlinkSync(`./yidunpic/${loginList[jj].username}_send.png`)
                // eslint-disable-next-line no-empty
                }catch(e) {


                }
                
            }
        }

    }

    async puppeteerClusterRunLogin(proxyIP, mailSenderList, webMailType) {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: this.puppeteerOpt.maxConcurrency,
            timeout:this.puppeteerOpt.timeout,
            puppeteerOptions: {
                headless: this.puppeteerOpt.headless,
                devtools: false,
                ignoreHTTPSErrors: true,
                defaultViewport: { width: 1920, height: 1080 },
                // defaultViewport:null,
                args: [
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-setuid-sandbox',
                    '--no-first-run',
                    '--no-zygote',
                    '--no-sandbox',
                    '--disable-infobars',
                    `--proxy-server=${proxyIP}`,
                    `--window-size=${1600},${600}`,
                    // `--window-position=x,y`
                ],
            }
        });

        cluster.on('taskerror', (err, data) => {
            logger.error(`===Error crawling=== ${data}: ${err.stack}`);
        });     


        const  login = async ({ page, data }) => {
            const { username, password , webMailType, indexInList} = data;
            let webState 
            if (webMailType == WebMailType.WebMailType126) {
                let {state, verifyCount} =  await this.webMail.mailAccount126CookieFetchUsingPage(page, username, password)
                webState = state
                this.mailList[indexInList].cookieState = state
                this.mailList[indexInList].verifyCount = verifyCount
            }else {
                let {state, verifyCount} = await this.webMail.mailAccount163CookieFetchUsingPage(page, username, password)
                this.mailList[indexInList].cookieState = state
                this.mailList[indexInList].verifyCount = verifyCount
                logger.error(`username ${username} index ${indexInList} verifyCount ${verifyCount}`)
                webState = state
            }
            await this.webMail.updateMailAccountDbInfo(username,webMailType, password,  webState)
            

        }
        for (let ii = 0; ii < mailSenderList.length; ii++) {
            cluster.queue({
                username:mailSenderList[ii].username,
                password:  mailSenderList[ii].password,
                webMailType: webMailType,
                indexInList: mailSenderList[ii].indexInList,
            }, login)
        }

        await cluster.idle();
        await cluster.close();

    }    

    async connectProxyServer() {
        this.proxyEngine = new  peaProxy('',  mailLoginCfg.proxy.proxyApiKey, mailLoginCfg.proxy.whiteIpIndex)
        await this.proxyEngine.init()
    }    

    getLoginDetailInfo() {
        let obj = {}
        let mailList = this.mailList
    
        obj.needCheckCount = mailList.length
        obj.checkedList = []
        for (let ii = 0; ii <mailList.length; ii++) {
            if (mailList[ii].execState == BulkLogin.LoginExecState.LoginExecStateExecuted) {
                let mailObj = {}
                let cookieState = mailList[ii].cookieState
                mailObj.username = mailList[ii].username
                mailObj.cookieState = cookieState
                mailObj.verifyCount = mailList[ii].verifyCount
                obj.checkedList.push(mailObj)
            }
        }
        return obj;
    }

    async mailAccountGetNeedCheck(authReCheck=false) {
        this.authReCheck  = authReCheck
        await this.mailAccountPreCheck()
        let needCheckList = []
        for (let ii = 0; ii < this.mailList.length; ii++) {
            if (this.mailList[ii].execState != BulkLogin.LoginExecState.LoginExecStateExecuted) {
                let obj = this.mailList[ii]
                Object.assign(obj, this.mailList[ii])
                needCheckList.push(obj)
            }
        }
        return needCheckList;
    }

}


if(__filename === process.mainModule.filename) {
    (async function() {
        let bulkLogin = new BulkLogin();
        let webType 
        await bulkLogin.init(mailLoginCfg)
    
        if (mailLoginCfg.mailSenderFile.webType === '126') {
            bulkLogin.mailAccountLoadFromFile(mailLoginCfg.mailSenderFile.filename, WebMailType.WebMailType126)
            webType = WebMailType.WebMailType126
        }else if (mailLoginCfg.mailSenderFile.webType === '163'){
            bulkLogin.mailAccountLoadFromFile(mailLoginCfg.mailSenderFile.filename, WebMailType.WebMailType163)
            webType = WebMailType.WebMailType163
        }else {
            logger.error(`不支持的邮箱类型 ${mailLoginCfg.webTyp}`)
            return
        }
        let backServ = new BackendServer(3001);
        backServ.setGetSuccessFun(()=> {
            let loginInfo = bulkLogin.getLoginDetailInfo();
            let outputHtml;
            outputHtml = `<h1> 总共${loginInfo.needCheckCount}个邮箱地址 已检查 ${loginInfo.checkedList.length}个</h1>`
    
            for (let ii = 0; ii < loginInfo.checkedList.length; ii++) {
                let username = loginInfo.checkedList[ii].username
                let stateStr = BulkLogin.webMailStateToStr(loginInfo.checkedList[ii].cookieState)
                outputHtml += `<br> ${username}    ${stateStr}</br>`
            }
            return outputHtml;
    
        });
        backServ.run();        
        await bulkLogin.mailAccountsLogin(webType)
    })();
    
    // (async function() {
    //     let bulkLogin = new BulkLogin();
    //     let webType 
    //     await bulkLogin.init(mailLoginCfg)
        
    //     await bulkLogin.mailAccountsLogin(webType)
    // })();
    
}

module.exports =  BulkLogin
