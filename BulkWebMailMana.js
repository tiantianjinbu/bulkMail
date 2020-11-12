const logger = require('./logger.js');
const fs = require('fs')
const peaProxy = require('./PeaProxy.js')
const BackendServer = require('./BackendServer')
const mailCfg = require('./mailcfg.json')
const CookieManager = require("./CookieManager")
const WebMail = require("./WebMail.js")
const { Cluster } = require('./node_modules/puppeteer-cluster/dist');

let MailVendorType = {
    MailVendorUnknow: 0,
    MailVendor126: 1,
    MailVendor163: 2,
    MailVendorQQ: 3
}

class mailAcount {
    constructor() {
        this.name = '';
        this.propetry = 0;
        this.webType = MailVendorType.MailVendorUnknow
        this.state = WebMail.WebMailSendState.WebMailSendStateUnKnown
        this.errorMsg = ''
        this.usedCount = 0;
        this.succDeliver = 0;
        this.sendingList = []
        this.sendHisList = [];
        
    }
}

let WebMailType = {
    WebMailType126:1,
    WebMailType163:2,
}


let MailProxyType = {
    MailProxyZhanDaye: 1,
    MailProxyPea: 2,
}

let MailConst = {
    MailConstOneDayMs: 3600*1000*24
}


class BulkWebMailManager {
    constructor() {
        this.mailSenderList = [];
        this.mailReceiverList = [];
        this.mailReceiverTestList = []
        this.mailSendHistory = [];
        this.proxyEngine = null;
        this.maxRejectTimes = 3;
        this.mailContentVariable = [];
        this.mailSenderMaxUsedCount = 10;
        this.mailMaxParallel = 10;
        this.mailReceiverStart = 0;
        this.mailReceiverTotal = 0;
        this.mailSenderStart = 0;
        this.mailSenderTotal = 0;
        this.mailReceiverTestStart = 0;
        this.mailReceiverTestTotal = 0;
        this.cookieMana = new CookieManager()
        this.webMail = new WebMail();
        this.waitTimeEachSend = 5000
        this.mailEachSendCount = 5;
        this.puppeteerOpt = {maxConcurrency:2, headless:true, timeout:90000}

    }

    async init(mongoCfg, chaoJiYingCfg) {
        let mongoUrl =  `mongodb://${mongoCfg.ip}:${mongoCfg.port}/`
        await this.cookieMana.initConnect(mongoUrl)
        this.webMail.setupChaoJiYing(chaoJiYingCfg.user, chaoJiYingCfg.password, chaoJiYingCfg.softid);
        await this.webMail.init(false, mongoUrl);
    }

    mailScopeSet(sendBaseStart, sendTotalNum, receBaseStart, receTotalNum, testBaseStart, TestTotalNum) {
        this.mailSenderStart = sendBaseStart;
        this.mailSenderTotal = sendTotalNum;
        this.mailReceiverStart = receBaseStart;
        this.mailReceiverTotal = receTotalNum;
        this.mailReceiverTestStart = testBaseStart;
        this.mailReceiverTestTotal = TestTotalNum;
    }

    sleep(time = 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve()
            }, time)
        })
    }

    mailPuppeteerOptSet(opt) {
        this.puppeteerOpt.maxConcurrency = opt.maxConcurrency
        this.puppeteerOpt.headless = opt.headless
        this.puppeteerOpt.timeout = opt.timeout
    }

    mailSendControlOptSet(mailAccountMaxParallel, mailAccountMaxEachSend, mailAccountMaxTotalSend, waitTimeEachSend) { 
        this.mailMaxParallel = mailAccountMaxParallel;
        this.mailEachSendCount = mailAccountMaxEachSend;
        this.mailSenderMaxUsedCount = mailAccountMaxTotalSend;
        this.waitTimeEachSend = waitTimeEachSend;
    }

    async loadMailSender() {
        let that = this;
        let validList = await this.cookieMana.getCookieNameTypeList(this.mailSenderStart, this.mailSenderTotal,(cookieObj)=>{
            if (cookieObj.sendInfoList == undefined) {
                return true;
            }
            // latest send is more than 24 hours ago, this acount can send mail
            if (Date.now() - cookieObj.sendInfoList[0].sendInfo.time >  MailConst.MailConstOneDayMs) {
                return true;
            }           
             
            // has been forbiden, or need verify code to continue sending. Do not use this mail acount within 24 hours
            if (cookieObj.state.sendState == WebMail.WebMailSendState.WebMailSendStateForbiden || 
                cookieObj.state.sendState ==   WebMail.WebMailSendState.WebMailSendStateVerifyCodeSuccess ||
                cookieObj.state.sendState ==   WebMail.WebMailSendState.WebMailSendStateVerifyCodeFail) {
                return false; 
            }
            // Check  all the sendInfo within 24 hours and don't send mail if the total count exceeds
            let totalCount = 0;
            for (let ii = 0; ii < cookieObj.sendInfoList.length; ii++) {
                if (Date.now() - cookieObj.sendInfoList[ii].sendInfo.time >  MailConst.MailConstOneDayMs) {
                    break;
                }
                totalCount += cookieObj.sendInfoList[ii].sendInfo.length;
            } 

            if (totalCount >= that.mailSenderMaxUsedCount) {
                return false;
            }
     
            return true;

        });
        
        if (Array.isArray(validList) && validList.length >0 ) {
            validList = validList.map(function (x) {
                let mailA = new mailAcount();
                mailA.name = x.name;
                mailA.webType = x.webType;
                if (x.state != undefined){
                    mailA.state = x.state
                }else {
                    mailA.state = WebMail.WebMailSendState.WebMailSendStateNormal
                }
                
                mailA.sendInfo = x.sendInfo;
                return mailA;
            })
        }else {
            logger.error("加载发送账号失败")
        }
        /*
        this.mailSenderList = validList.filter((mailAcount)=> {
            if (mailAcount.sendInfo == undefined) {
                return true;
            }
            if (Date.now() - mailAcount.sendInfo.time >  MailConst.MailConstOneDayMs) {
                return true;
            }           
            if (mailAcount.state.sendState == WebMail.WebMailSendState.WebMailSendStateForbiden || 
                mailAcount.state.sendState ==   WebMail.WebMailSendState.WebMailSendStateVerifyCodeSuccess ||
                mailAcount.state.sendState ==   WebMail.WebMailSendState.WebMailSendStateVerifyCodeFail) {
                return false; 
            }


            if (mailAcount.sendInfo.sendInfo.length > this.mailSenderMaxUsedCount) {
                return false;
            }
        })
        */
        // random the sequence
        this.mailSenderList  = validList
        let start = this.getRandomNum(0, this.mailSenderList.length)
        this.mailSenderList =  this.mailSenderList.slice(start, this.mailSenderList.length).concat(this.mailSenderList.slice(0, start))

    }

    loadMailTestReceiver(filename) {
        let mailfscontent = fs.readFileSync(filename, 'utf-8')
        let maillist = mailfscontent.split('\r\n')
        let index = 0;
        let total = 0;

        for (let ii = 0; ii < maillist.length; ii++) {
            if (maillist[ii].length < 5) {
                logger.error(`Test Receiver 邮箱地址错误${maillist[ii]}`)
                continue;
            }
            index++;
            if (index < this.mailReceiverTestStart) {
                continue;
            }
            let addrobj = new mailAcount();
            addrobj.name = maillist[ii];
            this.mailReceiverTestList.push(addrobj);

            total++;
            if (total >= this.mailReceiverTestTotal) {
                break;
            }
        }


    }
    loadMailReceiver(filename) {
        let index = 0;
        let total = 0;
        logger.error(`filename ${filename}`)
        let mailfscontent = fs.readFileSync(filename, 'utf-8')
        let maillist = mailfscontent.split('\r\n')
        /* push test mail address*/

        for (let ii = 0; ii < maillist.length; ii++) {
            if (maillist[ii].length < 5) {
                logger.error(`Receiver 邮箱地址错误${maillist[ii]}`)
                continue;
            }
            index++;
            if (index < this.mailReceiverStart) {
                continue;
            }
            let addrobj = new mailAcount();
            addrobj.name = maillist[ii];
            this.mailReceiverList.push(addrobj);

            total++;
            if (total >= this.mailReceiverTotal) {
                break;
            }
        }
    }

    appendTestReceiver() {
        let spreadIntval = 0;
        if (this.mailReceiverTestList.length > 2) {
            spreadIntval = this.mailReceiverList.length / (this.mailReceiverTestList.length - 2)
        }
        for (let ii = 0; ii < this.mailReceiverTestList.length; ii++) {
            // Add the two to the first 
            if (ii < 2) {
                let obj = this.mailReceiverTestList[ii];
                this.mailReceiverList.splice(0, 0, obj);
            } else {  // spread others to the list
                let obj = this.mailReceiverTestList[ii];
                this.mailReceiverList.splice(spreadIntval * (ii - 2), 0, obj);
            }
        }
    }


    loadVariable(filename) {
        let content = fs.readFileSync(filename, 'utf-8')
        let contentList = content.split('\r\n')

        for (let ii = 0; ii < contentList.length; ii++) {
            if (contentList[ii].length < 5) {
                // logger.error(`变量太短${contentList[ii]}`)
                continue;
            }
            this.mailContentVariable.push(contentList[ii]);
        }
    }

    async connectProxyServer(apiid, apikey, whiteIpIndex, proxyType = MailProxyType.MailProxyZhanDaye) {
        if (proxyType == MailProxyType.MailProxyZhanDaye) {
            // this.proxyEngine = new zhanDaye(apiid, apikey)
        } else if (proxyType == MailProxyType.MailProxyPea) {
            this.proxyEngine = new peaProxy(apiid, apikey, whiteIpIndex)
        } else {
            logger.error('不支持的代理类型')
        }
        await this.proxyEngine.init()
    }

    mailSenderShow() {
        for (let ii = 0; ii < this.mailSenderList.length; ii++) {
            console.log(this.mailSenderList[ii])
        }
    }

    mailReceiverShow() {
        for (let ii = 0; ii < this.mailReceiverList.length; ii++) {
            console.log(this.mailReceiverList[ii])
        }
    }




    bulkMailOverLoadCheck() {
        if (this.mailSenderList.length * this.mailSenderMaxUsedCount < this.mailReceiverList.length) {
            return false;
        } else {
            return true;
        }
    }

  
    /*
        Make a N:1 sending list for each sender mail acount after the first sending cycle finishes 
        As some acounts have issue to send and the receiver mails are left in the sendlingList,
        find these mails out and re-assign the sending work
    */
    async bulkMailReAssignSendingWork(maxLoopCount, mailContentList, addVariable) {
        // check the total left account and sender can continue the sending 
        let leftMailList = []
        
        for (let loop = 0; loop < maxLoopCount; loop++) {
            for (let ii = 0; ii < this.mailSenderList.length; ii++) {
                if (this.mailSenderList[ii].sendingList.length >0) {
                    for (let jj = 0; jj < this.mailSenderList[ii].sendingList.length; jj++) {
                        leftMailList.push(this.mailSenderList[ii].sendingList[jj])
                    }
                    this.mailSenderList[ii].sendingList = []
                }
                
            }

            logger.info(`剩余发送任务 ${leftMailList.length}， 第${loop}次调整`)
            if (leftMailList.length == 0) {
                return;
            }
            // make a sequence list for the sender list that can be used for this sending turn
            let avaSenderList = []
            for (let ii = 0; ii < this.mailSenderList.length; ii++) {
                if (this.mailSenderList[ii].state == WebMail.WebMailSendState.WebMailSendStateNormal) {
                    let {res, sendInfoList} = await this.cookieMana.getCookieStateAndSendingHis(this.mailSenderList[ii].name, this.mailSenderList[ii].webType)
                    if (res == 'error') {
                        continue;
                    }      
                    // logger.info(`mail ${this.mailSenderList[ii].name}` )             
                    // logger.info(sendInfoList)
                    let alreadySendCountInOneDay =0;
                    let successCountInOneDay = 0;
                    let totalSendCount = 0;
                    let totalSuccessCount = 0;
                    let canSendCount = 0;
                    for (let jj = 0; sendInfoList && jj < sendInfoList.length; jj++) {
                        let succ = 0;
                        let fail = 0;
                        for (let kk = 0; kk < sendInfoList[jj].sendInfo.length; kk++) {
                            if (sendInfoList[jj].sendInfo[kk].result.state == 'error') {
                                fail++;
                            }else {
                                succ++;
                            }
                        }
                        totalSendCount += (fail + succ);
                        totalSuccessCount += succ;
                        // logger.info(`mail ${this.mailSenderList[ii].name}  sendTime  ${sendInfoList[jj].time} ` )
                        // eslint-disable-next-line no-empty
                        if (Date.now() - sendInfoList[jj].time >  MailConst.MailConstOneDayMs) {
                        }else {
                            alreadySendCountInOneDay += fail + succ;
                            successCountInOneDay += succ;
                        }
                    } 
                    // logger.info(`mail ${this.mailSenderList[ii].name} alreadySendInOneDay ${alreadySendCountInOneDay}` )
                    canSendCount = this.mailSenderMaxUsedCount - alreadySendCountInOneDay;
                    if (canSendCount <=0) {
                        continue;
                    }

                    // if all the sent were failed in the history and history sent count large than 10, 
                    // and has already sent out 2 mails today, don't use this 
                    if (totalSendCount > 10 && totalSuccessCount == 0 && alreadySendCountInOneDay >= 2) {
                        continue;
                    }

                    let obj = {};
                    obj.sender = this.mailSenderList[ii];
                    obj.alreadySendCountInOneDay = alreadySendCountInOneDay;
                    obj.successCountInOneDay = successCountInOneDay;
                    obj.totalSendCount = totalSendCount;
                    obj.totalSuccessCount = totalSuccessCount;
                    avaSenderList.push(obj)
                }
            }

            if(avaSenderList.length == 0) {
                logger.error(`剩余发送任务 ${leftMailList.length}，没可用发送资源`)
                // add the left to one sender for the left send showing
                for (let ii = 0; ii < leftMailList.length; ii++) {
                    this.mailSenderList[0].sendingList.push(leftMailList[ii])
                }
                return
            }

            let ratio = parseInt(leftMailList.length/avaSenderList.length)
            
            // assign each sender sending ratio mail first
            for (let ii = 0; ii < avaSenderList.length; ii++) {
                if (leftMailList.length == 0) {
                    break;
                } 
                let canSendCount = this.mailSenderMaxUsedCount - avaSenderList[ii].alreadySendCountInOneDay;
                for (let jj = 0; jj < ratio && jj < canSendCount; jj++) {
                    let mailSend = leftMailList.shift();
                    avaSenderList[ii].sender.sendingList.push(mailSend)
                    if (leftMailList.length == 0) {
                        break;
                    }                    
                }
            }

            // there should be some left, assign one to each sender
            // first loop, starting from the last one, as the bottom ends might be not used
            if (loop == 0) {
                
                for (let ii = avaSenderList.length -1; ii >=0; ii--) {
                    if (leftMailList.length == 0) {
                        break;
                    }
                    let index = ii
                    let canSendCount = this.mailSenderMaxUsedCount - avaSenderList[index].alreadySendCountInOneDay;
                    for (let jj = 0; jj < 1 && jj < canSendCount; jj++) {
                        let mailSend = leftMailList.shift();
                        avaSenderList[index].sender.sendingList.push(mailSend)       
                    }
                }

            }else {
                let randStart = this.getRandomNum(0, avaSenderList.length)
                // there should be some left, assign one to each sender
                for (let ii = 0; ii < avaSenderList.length; ii++) {
                    if (leftMailList.length == 0) {
                        break;
                    }
                    let index = (ii + randStart)%avaSenderList.length
                    let canSendCount = this.mailSenderMaxUsedCount - avaSenderList[index].alreadySendCountInOneDay;
                    for (let jj = 0; jj < 1 && jj < canSendCount; jj++) {
                        let mailSend = leftMailList.shift();
                        avaSenderList[index].sender.sendingList.push(mailSend)       
                    }
                }

            }

            // still has some left?  just push to the first one
            for (let ii = 0; ii < leftMailList.length; ii++) {
                avaSenderList[0].sender.sendingList.push(leftMailList[ii])
            }
            leftMailList = []

            await  this.bulkMailSendLoop(mailContentList, addVariable);
        }
    }
    /*
        Make a N:1 sending list for each sender mail acount, this is the first time send
    */
    bulkMailPairListBuild() {
        let randStart = this.getRandomNum(0, this.mailReceiverList.length);
        let ratio = this.mailReceiverList.length / this.mailSenderList.length;
        // The average sending count for each sender mail
        let interval = parseInt(ratio);
        let sendStart = randStart;

        // if reciver less than the sender, assign each sender one mail sending task 
        if (this.mailReceiverList.length <= this.mailSenderList.length) {
            for (let ii = 0 ; ii < this.mailReceiverList.length; ii++) {
                this.mailSenderList[ii].sendingList.push((sendStart + ii)%this.mailReceiverList.length)
            }
            return interval ;
        }

        for (let ii = 0; ii < this.mailSenderList.length; ii++) {
            for (let jj = sendStart; jj < sendStart + interval; jj++) {
                this.mailSenderList[ii].sendingList.push(jj % this.mailReceiverList.length)
            }
            sendStart += interval;
        }
        let leftCount = this.mailReceiverList.length - interval * this.mailSenderList.length
        for (let ii = 0; ii < this.mailSenderList.length && leftCount > 0; ii++, leftCount--) {
            this.mailSenderList[ii].sendingList.push(sendStart % this.mailReceiverList.length)
            sendStart++;
        }
        return interval;

    }

    getRandomNum(min, max) {
        let range = max - min;
        let rand = Math.random();
        return (min + Math.round(rand * range));
    }

    async bulkMailSend(mailContentList, addVariable) {
        if (this.bulkMailOverLoadCheck() == false) {
            logger.error(`发件箱数目${this.mailSenderList.length}*2 小于收件箱数目 ${this.mailReceiverList.length}`);
        }

        if (mailContentList.length <=0) {
            logger.error('没有发送内容')
            return
        }
        let sendCount = this.bulkMailPairListBuild();
        // adjust the value 
        sendCount += 1;
       
        logger.info(`:: each send count ${sendCount} ${this.mailEachSendCount} ${sendCount/this.mailEachSendCount}`)
        // As has a limit for each time send,  so the bulkMailSendLoop need calling multiple times
        for (let ii = 0; ii < sendCount/this.mailEachSendCount; ii++) {
            logger.info(`::开始 sendloop ${ii}::`)
            await this.bulkMailSendLoop(mailContentList, addVariable);
        }
        
        // There must be some sending works failed due to many reasons, re assign the failing work
        // meanwhile limit the max loop counts to 3
        await this.bulkMailReAssignSendingWork(3, mailContentList, addVariable)
    }

    async senderSendLoop(page, mailSender, maxSend, mailInfoList) {
        logger.info(`send mail loop ${mailSender.name}`)
        // logger.info(page)
        let result;
        if (mailSender.webType == WebMailType.WebMailType126) {
            result = await this.webMail.login126WithCookieUsingPage(page, mailSender.name, '');
        }else {
            result = await  this.webMail.login163WithCookieUsingPage(page, mailSender.name, '');
        }
        // logger.info(`${mailSender.name} cookie result ${result}`)
        if (result == undefined) {
            logger.error(`${mailSender.name} cookie 登录失败`)
            return
        }
        let loopCount = 0;
        let mailSendList  = []
        let sndRes;
        while (loopCount < maxSend) {
            
            if (mailSender.sendingList.length == 0) {
                logger.error(`${mailSender.name} 发送完毕`)
                break;
            }
            let index = mailSender.sendingList.shift()
            logger.info(`${mailSender.name} send ${this.mailReceiverList[index].name}`)
            if (mailSender.webType == WebMailType.WebMailType126) {
                sndRes = await this.webMail.mainSendMailFrom126UsingPage(page, mailSender.name, this.mailReceiverList[index].name,
                mailInfoList[loopCount].subject,
                mailInfoList[loopCount].content,
                mailInfoList[loopCount].mailImage)
            }else {
                sndRes = await this.webMail.mainSendMailFrom163UsingPage(page, mailSender.name, this.mailReceiverList[index].name,
                    mailInfoList[loopCount].subject,
                    mailInfoList[loopCount].content,
                    mailInfoList[loopCount].mailImage)
            }
            // record the mail sending result
            let obj = {}
            obj.index = index;
            obj.mailAddr = this.mailReceiverList[index].name;
            obj.result = sndRes;

            mailSender.sendHisList.push(obj)
            mailSendList.push(obj)
            mailSender.state = sndRes.rescode

            // update cookie state
            
            if (obj.result.state == 'error') {
                logger.error(`${mailSender.name} 账号异常,发信失败`)
                await this.cookieMana.appendCookieAssociate(mailSender.name, mailSender.webType, sndRes.rescode);
                break
            }
            // as need check the result further, setting the result to init here
            obj.result.state = 'init'
            
            loopCount++;
            if (loopCount < maxSend) {
                await this.sleep(this.waitTimeEachSend)
            }
        }

        let sendResult;
        // 检查发送情况， 通过查看发件箱的发件记录
        if (mailSender.webType == WebMailType.WebMailType126) {
            let sendCheckList = [];
            
            for (let ii = 0; ii < mailSendList.length; ii++) {
                sendCheckList.push(mailSendList[ii].mailAddr);
            }
            sendResult = await this.webMail.checkMailFrom126SendResult(page, sendCheckList)
        }else {
            let sendCheckList = [];
            
            for (let ii = 0; ii < mailSendList.length; ii++) {
                sendCheckList.push(mailSendList[ii].mailAddr);
            }
            sendResult = await this.webMail.checkMailFrom163SendResult(page, sendCheckList)
        }
        // Can't get the result,suppose it's failed
        if (sendResult.res == 'error') {
            logger.error(`无法获取发送结果`)
            for (let ii = 0; ii < mailSendList.length; ii++) {
                
                mailSendList[ii].result.state = 'error';
                mailSendList[ii].result.rescode = WebMail.WebMailSendState.WebMailSendStateReject
                // Add back to the sendlingList
                // mailSender.sendingList.splice(0,0, mailSendList[ii].index)
                mailSender.sendingList.push(mailSendList[ii].index)
            }
        }else if (sendResult.res == 'ok') {// update the send result based on the checking
            for (let ii = 0; ii < mailSendList.length; ii++) {
                if (sendResult.result[ii].state == "success") {
                    mailSendList[ii].result.state = 'ok';
                }else if (sendResult.result[ii].state == 'reject') {
                    mailSendList[ii].result.state = 'error';
                    mailSendList[ii].result.rescode = WebMail.WebMailSendState.WebMailSendStateReject
                    // Add back to the sendlingList
                    // mailSender.sendingList.splice(0,0, mailSendList[ii].index)
                    mailSender.sendingList.push(mailSendList[ii].index)

                }else {
                    logger.error(`receiver: ${sendResult.result[ii].receiver} state ${sendResult.result[ii].state}`)
                    mailSendList[ii].result.state = 'error';
                    mailSendList[ii].result.rescode = WebMail.WebMailSendState.WebMailSendStateReject
                    // Add back to the sendlingList
                    // mailSender.sendingList.splice(0,0, mailSendList[ii].index)
                    mailSender.sendingList.push(mailSendList[ii].index)
                }
            }
        }else {
            logger.error('内部错误， 无法获取发送结果')
        }


        if (mailSendList.length != 0) {
            await this.cookieMana.appendCookieAssociate(mailSender.name, mailSender.webType, sndRes.rescode, mailSendList)
        }
    }

    async puppeteerClusterRun(proxyIP, mailSenderList, mailContentList, variableList, sendLimit) {
        let puppeteerArgs 
        if (proxyIP != '') {
            puppeteerArgs = [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--no-sandbox',
                '--disable-infobars',
                `--proxy-server=${proxyIP}`
            ]      
        }else {
            puppeteerArgs = [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--no-sandbox',
                '--disable-infobars'
            ]  
        }


        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: this.puppeteerOpt.maxConcurrency,
            timeout:this.puppeteerOpt.timeout,
            puppeteerOptions: {
                headless: this.puppeteerOpt.headless,
                args: puppeteerArgs
            }
        });

        cluster.on('taskerror', (err, data) => {
            logger.error(`===Error crawling=== ${data}: ${err.stack}`);
        });     

        const mailSend = async ({ page, data }) => {
            const { mailSender, maxSend, mailInfoList } = data;
            await this.senderSendLoop(page, mailSender, maxSend, mailInfoList)
        };
        for (let ii = 0; ii < mailSenderList.length; ii++) {
            let mailList = []
            let eachMaxSend = this.mailEachSendCount
            // TODO: Add variable to subject/content 
            if (sendLimit != undefined) {
                eachMaxSend = sendLimit
            }
            for (let jj = 0; jj < eachMaxSend; jj++) {
                let mailInfo = {}
                mailInfo.subject = mailContentList[(ii + jj)%mailContentList.length].mailSubject + mailSenderList[ii].name.split('@')[0]
                mailInfo.content = mailContentList[(ii + jj)%mailContentList.length].mailContent;
                mailInfo.mailImage = mailContentList[(ii + jj)%mailContentList.length].mailImage;
                if (variableList && variableList.length > 0) {
                    mailInfo.content += '\r\n\r\n\r\n\r\n'
                    mailInfo.content += variableList[(ii + jj)%variableList.length]
                }
                mailList.push(mailInfo)
            }
            logger.info(`Send mail using ${mailSenderList[ii].name}`)
            cluster.queue({
                mailSender: mailSenderList[ii],
                maxSend: eachMaxSend,
                mailInfoList: mailList
            }, mailSend)
        }

        await cluster.idle();
        await cluster.close();

    }
    /*
        addVariable: not used now 
    */
    async bulkMailSendLoop(mailContentList, addVariable = true) {
        // each 
        let loopC = 0;
        
        while(loopC < this.mailSenderList.length) {
            let senderCount = 0;
            let senderList = []
            let variableList = []   // mail centent variable
            while(senderCount <  this.mailMaxParallel) {
                if (this.mailSenderList[loopC].sendingList.length > 0) {
                    senderList.push(this.mailSenderList[loopC])
                    if (this.mailContentVariable.length > 0) {
                        let variableIndex = this.getRandomNum(0, this.mailContentVariable.length -1)
                        variableList.push(this.mailContentVariable[variableIndex])
                    }
                    senderCount++;
                }
                loopC++;
                if (loopC >= this.mailSenderList.length) {
                    break;
                }
            }

            if (senderList.length == 0) {
                break;
            }


            let proxyIP = ''
            if (this.proxyEngine != null) {
                let ipLoop = 0;
                let proxyIpList = []
                while (ipLoop < 3) {
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
                    return;
                }   
            }

            logger.info(`bulk send using IP ${proxyIP}`)
            await this.puppeteerClusterRun(proxyIP, senderList,mailContentList, variableList);
/* 
            let proxyIpCheckLoop = 0;
            let proxyIP = ''
            while (proxyIpCheckLoop < 3) {

                let ipLoop = 0;
                let proxyIpList = []
                proxyIP = ''
    
                while (ipLoop < 3) {
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
                    return;
                }              

                // logger.info(senderList)
                logger.info(`bulk send using IP ${proxyIP}`)
                // first each sender only sends one mail, and check the result. Use the mailSender.sendHisList to check
                let oriHisLenList = []
                let rejectCount = 0;
                for (let ii = 0; ii < senderList.length; ii++) {
                    oriHisLenList.push(senderList[ii].sendHisList.length);
                }
                
                await this.puppeteerClusterRun(proxyIP, senderList,mailContentList, variableList, 1);
                for (let ii = 0; ii < senderList.length; ii++) {
                    let curLen = senderList[ii].sendHisList.length;
                    if (curLen > oriHisLenList[ii]) {
                        if (senderList[ii].sendHisList[curLen -1].result.state == 'error' && 
                            senderList[ii].sendHisList[curLen -1].result.rescode == WebMail.WebMailSendState.WebMailSendStateReject) {
                                rejectCount++;
                        }
    
                    }else {
                    }
                }
            
                // TODO: can check the sender state and don't need further sending result check if the sender is forbiden

                if (rejectCount == senderList.length) {
                    logger.error(`all sending ${rejectCount} rejected with IP ${proxyIP}`)
                    proxyIpCheckLoop++;
                }else {
                    logger.info(`reject count ${rejectCount} sending count ${senderList.length}`)
                    break;
                }

                
            }

            // always failed, cancel this time sending 
            if (proxyIpCheckLoop == 3) {
                logger.error(`${proxyIpCheckLoop}次代理IP发送都失败`)
                continue;
            }
            // use this proxy IP for other sending task
            await this.puppeteerClusterRun(proxyIP, senderList,mailContentList, variableList);
             */
        }
       
    }
    /*
        return list of {sender:xxx, receiver:xxx} 
    */
    successMailOut() {
        let outList = []
        for (let ii = 0; ii < this.mailSenderList.length; ii++) {
            for (let jj = 0; jj < this.mailSenderList[ii].sendHisList.length; jj++) {
                let his = this.mailSenderList[ii].sendHisList[jj]
                if (his.result.state == 'ok') {
                    outList.push({sender:this.mailSenderList[ii].name, receiver:his.mailAddr});
                }
            }
        }
        return outList;
    }

    mailSenderStatOut() {
        let outList = []
        for (let ii = 0; ii < this.mailSenderList.length; ii++) {
            let obj = {}
            obj.address = this.mailSenderList[ii].name;
            obj.usedCount = this.mailSenderList[ii].sendHisList.length;
            obj.succDeliver = 0;
            obj.succList = [];
            obj.failList = [];
            for (let jj = 0; jj < this.mailSenderList[ii].sendHisList.length; jj++) {
                if ( this.mailSenderList[ii].sendHisList[jj].result.state == 'ok') {
                    obj.succDeliver++;
                    obj.succList.push(this.mailSenderList[ii].sendHisList[jj].mailAddr)
                }else {
                    obj.failList.push(this.mailSenderList[ii].sendHisList[jj].mailAddr)
                }
            }
            outList.push(obj)
        }
        return outList;
    }

    mailLeftSendOut() {
        let outList = []
        for (let ii = 0; ii < this.mailSenderList.length; ii++) {
            for (let jj = 0; jj < this.mailSenderList[ii].sendingList.length; jj++) {
                let index = this.mailSenderList[ii].sendingList[jj]
                outList.push(this.mailReceiverList[index].name)
            }
        }
        return outList;
    }

    async runWebMailLoop(cfgJson) {
        let bulkMail = this;
        let mailReceiver = cfgJson.mailReceiverFile;
        let addVariable = cfgJson.mailVariableNeed;
        let mailContentList = cfgJson.mailContentList
        if (mailReceiver == '') {
            logger.error('没有接受文件')
            return;
        }
    
        await bulkMail.init(cfgJson.mongoCfg, cfgJson.chaoJiYing);
        bulkMail.mailScopeSet(cfgJson.mailSenderStart, cfgJson.mailSenderCount,
            cfgJson.mailReceiverStart, cfgJson.mailReceiverCount,
            cfgJson.mailReceiverTestStart, cfgJson.mailReceiverTestCount);
        // logger.info(`cfg info ${cfgJson.mailSenderStart} ${cfgJson.mailSenderCount} ${cfgJson.mailReceiverStart} ${cfgJson.mailReceiverCount}`)
        bulkMail.mailPuppeteerOptSet(cfgJson.puppeteer)
        bulkMail.mailSendControlOptSet(cfgJson.mailAccountMaxParallel, cfgJson.mailAccountMaxEachSend, 
                                    cfgJson.mailAccountMaxTotalSend, cfgJson.waitTimeEachSend)
        await bulkMail.loadMailSender();
        bulkMail.loadMailReceiver(mailReceiver);
        bulkMail.loadMailTestReceiver(cfgJson.mailReceiverTestFile);
        bulkMail.appendTestReceiver();
    
        if (addVariable == true) {
            if (cfgJson.mailVariableFile == '') {
                logger.error('没有邮箱变量文件')
                return;
            }
            bulkMail.loadVariable(cfgJson.mailVariableFile)
        }
    
        if (cfgJson.proxy.useProxy) {
            await bulkMail.connectProxyServer('', cfgJson.proxy.proxyApiKey,  cfgJson.proxy.whiteIpIndex, MailProxyType.MailProxyPea);
        }
    
        await  bulkMail.bulkMailSend(mailContentList, addVariable );

    }
}

async function testBulkMailSendPeaProxy() {
    let bulkMail = new BulkWebMailManager()
    let backServ = new BackendServer(3000);
    let mailReceiver = mailCfg.mailReceiverFile;
    let addVariable = mailCfg.mailVariableNeed;
    let mailContentList = mailCfg.mailContentList

    let mailPlainText = mailCfg.mailPlainText;
    if (mailReceiver == '') {
        logger.error('没有接受文件')
        return;
    }

    function successMailOutHtml() {
        let outList = bulkMail.successMailOut();
        let outputHtml;
        outputHtml = `<h1> 总共发出 ${outList.length} 封</h1>`
        for (let ii = 0; ii < outList.length; ii++) {
            outputHtml += `<br> ${outList[ii]}</br>`
        }
        return outputHtml;
    }

    function mailSenderStatOutHtml() {
        let outList = bulkMail.mailSenderStatOut();
        let outputHtml = ''
        for (let ii = 0; ii < outList.length; ii++) {
            let succRate = 0;
            if (outList[ii].usedCount == 0) {
                succRate = -100;
            } else {
                succRate = outList[ii].succDeliver * 100 / outList[ii].usedCount;
            }
            outputHtml += `<br> ${ii}: ${outList[ii].address} ${outList[ii].usedCount} ${outList[ii].succDeliver} ${succRate}</br>`
        }
        return outputHtml;
    }

    backServ.setGetSuccessFun(successMailOutHtml);
    backServ.setGetSenderStatFun(mailSenderStatOutHtml)
    backServ.run();
    await bulkMail.init();
    bulkMail.mailScopeSet(mailCfg.mailSenderStart, mailCfg.mailSenderCount,
        mailCfg.mailReceiverStart, mailCfg.mailReceiverCount,
        mailCfg.mailReceiverTestStart, mailCfg.mailReceiverTestCount);
    // bulkMail.loadMailSender('./selftest.txt');
    await bulkMail.loadMailSender();
    bulkMail.loadMailReceiver(mailReceiver);
    bulkMail.loadMailTestReceiver(mailCfg.mailReceiverTestFile);
    bulkMail.appendTestReceiver();

    if (addVariable == true) {
        if (mailCfg.mailVariableFile == '') {
            logger.error('没有邮箱变量文件')
            return;
        }
        bulkMail.loadVariable(mailCfg.mailVariableFile)
    }

    if (mailCfg.proxy.useProxy) {
        await bulkMail.connectProxyServer('', mailCfg.proxy.proxyApiKey, mailCfg.proxy.whiteIpIndex, MailProxyType.MailProxyPea);
    }

    await  bulkMail.bulkMailSend(mailContentList, addVariable, mailPlainText );

}


if(__filename === process.mainModule.filename) {
    testBulkMailSendPeaProxy();

}


module.exports =  BulkWebMailManager