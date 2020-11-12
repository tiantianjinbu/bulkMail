const cluster = require('cluster')
const logger = require('./logger')
var mailLoginCfg = require('./maillogincfg.json')
const BulkLogin = require('./BulkLogin.js')
const BackendServer = require('./BackendServer.js')
const fs = require('fs')




class BulkLoginCluster {
    static messageCmd = {
        messageCmdOutSuccReq: 1,
        messageCmdOutSuccRes: 2,
        messageCmdStartBulkLoginReq: 3,
        messageCmdStartBulkLoginRes: 4,        

    }
    constructor(maxWorker = 0) {
        this.workers = []
        this.waitList = []
        this.loginWorker = null
        this.maxWorker = maxWorker
        
    }

    sleep(time = 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve()
            }, time)
        })
    }    



    async setupBulkLoginWorkerProcess() {
        let numCores = require('os').cpus().length
        let that = this;
        that.maxWorker = mailLoginCfg.nodeCluster.maxCore
        if (that.maxWorker > numCores || that.maxWorker == 0) {
            that.maxWorker = numCores;
        }
    
        logger.info('Master cluster setting up ' + that.maxWorker + ' workers')
        let bulkLogin = new BulkLogin()
        that.loginWorker = bulkLogin
        await bulkLogin.init(mailLoginCfg)
        
        bulkLogin.mailAccountLoadFromFile(mailLoginCfg.mailSenderFile.filename)
        logger.info('Master cluster 检查账号......')
        let needCheckList = await bulkLogin.mailAccountGetNeedCheck(mailLoginCfg.authReCheck)
        let eachCount = parseInt(needCheckList.length/that.maxWorker);
        logger.info('total Check length ' + needCheckList.length)

        for (let ii = 0; ii < that.maxWorker; ii++) {
            let worker = {}
            let mailLoginCfgAss =  {}
            Object.assign(mailLoginCfgAss, mailLoginCfg)
            worker.worker = cluster.fork()
            let mailCheckList
            if (ii != that.maxWorker.length - 1) {
                mailCheckList = needCheckList.slice(eachCount * ii, eachCount * (ii + 1))
            }else {
                mailCheckList = needCheckList.slice(eachCount * ii, needCheckList.length)
            }

            worker.mailLoginCfg = mailLoginCfgAss
            worker.mailCheckList = mailCheckList
            this.workers.push(worker)
        }
        let backServ = new BackendServer(mailLoginCfg.backServerPort);
        backServ.setGetSuccessFun(async ()=> {
            that.waitList = []
            let waitCount  = 0;
            const maxWait = 20;
            for (let ii = 0; ii < that.workers.length; ii++) {
                that.workers[ii].worker.send({cmd:BulkLoginCluster.messageCmd.messageCmdOutSuccReq})
            }
            while (that.waitList.length < that.maxWorker && waitCount < maxWait) {
                await that.sleep(500)
                waitCount++
            }
            // master has the total count/alread checked count before assigning task to other workers
            let generalInfo = that.loginWorker.getLoginDetailInfo()
            let totalCount = 0;
            let outputHtml = ''
            let totalValidCount = 0;
            let totalHasVerify = 0;
            let totalVerifyCount = 0;
            totalCount = generalInfo.checkedList.length;
            
            for (let ii = 0 ; ii < generalInfo.checkedList.length; ii++) {
                let username = generalInfo.checkedList[ii].username
                let stateStr = BulkLogin.webMailStateToStr(generalInfo.checkedList[ii].cookieState)
                if (stateStr.indexOf('成功') != -1) {
                    totalValidCount ++;
                }
                outputHtml += `<br> ${username}    ${stateStr}</br>`               
            }

            for (let ii = 0; ii < that.waitList.length; ii++) {
                totalCount += that.waitList[ii].content.checkedList.length;
                for (let jj = 0; jj < that.waitList[ii].content.checkedList.length; jj++) {
                    let username = that.waitList[ii].content.checkedList[jj].username
                    let stateStr = BulkLogin.webMailStateToStr(that.waitList[ii].content.checkedList[jj].cookieState)
                    if (that.waitList[ii].content.checkedList[jj].verifyCount > 0)  {
                        totalHasVerify ++;
                        totalVerifyCount += that.waitList[ii].content.checkedList[jj].verifyCount
                    }
                    if (stateStr.indexOf('成功') != -1) {
                        totalValidCount ++;
                    }
                    outputHtml += `<br> ${username}    ${stateStr}  verifyCount ${that.waitList[ii].content.checkedList[jj].verifyCount}</br>`
                }
            }
            outputHtml =  `<h1> 总共${generalInfo.needCheckCount}个邮箱地址 已检查 ${totalCount}个 登录成功 ${totalValidCount}个  需验证码 ${totalHasVerify}个  请求验证码 ${totalVerifyCount}个</h1>` + 
                            outputHtml
            return outputHtml
        });

        backServ.setGetSenderStatFun(async ()=>{

        })
        backServ.run();        
        // spread the login worker to each worker 
    
        cluster.on('online', function(worker) {
            logger.info('worker ' + 'id ' + worker.id + ' pid: ' + worker.process.pid + ' online')
            if (worker.id > numCores) {
                logger.error(`workid ${worker.id} exceed the max cores ${numCores}`)
            }
            let index = worker.id -1    
            // Add some delay in case 
            setTimeout(()=>{
                that.workers[index].worker.send({cmd:BulkLoginCluster.messageCmd.messageCmdStartBulkLoginReq,
                    content: that.workers[index]})
            }, index * 10000)

        })

        cluster.on('message', function(worker, message) {
            // eslint-disable-next-line no-empty
            if (message.cmd == BulkLoginCluster.messageCmd.messageCmdStartBulkLoginRes) {
               
            }else if (message.cmd == BulkLoginCluster.messageCmd.messageCmdOutSuccRes)(
                that.waitList.push(message)
            )
        })

        cluster.on('exit', function(worker, code, signal) {
            logger.info('workder ' + worker.process.pid + ' died with code: ' + code + ', and signal: ' + signal)
        })
    }

    setUpWorkExecute(cluster) {


        process.on('message',  (message) => {
            if (message.cmd == BulkLoginCluster.messageCmd.messageCmdStartBulkLoginReq) {
               logger.info(`worker ${cluster.worker.id } receiver message messageCmdStartBulkLoginReq`)
               logger.info(`worker ${cluster.worker.id } needCheckList length ${message.content.mailCheckList.length}`)

               let bulkLogin = new BulkLogin()
               this.loginWorker = bulkLogin
               bulkLogin.init(message.content.mailLoginCfg).then(()=>{
                bulkLogin.mailAccountListSet(message.content.mailCheckList)
                bulkLogin.mailAccountsLogin(message.content.mailLoginCfg.authReCheck)
               })
            }else if (message.cmd == BulkLoginCluster.messageCmd.messageCmdOutSuccReq) {
                let result = this.loginWorker.getLoginDetailInfo()
                process.send({cmd:BulkLoginCluster.messageCmd.messageCmdOutSuccRes,
                    content:result})                     
            }

        })

    }
}

if(__filename === process.mainModule.filename) {
    (async () => {
        var args = process.argv
        // use the specified  config file 
        if (args.length > 2) {
            try {
                let cfgFile = args[2]
                let rawdata = fs.readFileSync(cfgFile);
                let mailLoadCfg = JSON.parse(rawdata);
                mailLoginCfg = mailLoadCfg
                logger.error(`use config file ${cfgFile}`)
            }catch(e) {
                logger.error(e)
            }
        }

        let mailLoginCluster = new BulkLoginCluster()
        if (cluster.isMaster) {
            mailLoginCluster.setupBulkLoginWorkerProcess()
        } else {
            mailLoginCluster.setUpWorkExecute(cluster)
        }
    })()
}




