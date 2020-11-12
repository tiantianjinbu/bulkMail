const cluster = require('cluster')
const logger = require('./logger')
var mailCfg = require('./mailcfg.json')
const BulkWebMailMana = require('./BulkWebMailMana')
const BackendServer = require('./BackendServer')
const fs = require('fs')



class BulkWebMailCluster {
    static messageCmd = {
        messageCmdOutSuccReq: 1,
        messageCmdOutSuccRes: 2,
        messageCmdSenderReq: 3,
        messageCmdSenderRes: 4,   
        messageCmdLeftSendReq:5,
        messageCmdLeftSendRes:6     
    }
    constructor(maxWorker = 0) {
        this.workers = []
        this.waitList = []
        this.mailWorker = null
        this.maxWorker = maxWorker
        
    }

    sleep(time = 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve()
            }, time)
        })
    }    



    setupBulkWebMailWorkerProcess() {
        let numCores = require('os').cpus().length
        let that = this;
        that.maxWorker = mailCfg.nodeCluster.maxCore
        if (that.maxWorker > numCores || that.maxWorker == 0) {
            that.maxWorker = numCores;
        }
    
        logger.info('Master cluster setting up ' + that.maxWorker + ' workers')
        let eachSendCount = parseInt(mailCfg.mailSenderCount /that.maxWorker)
        let eachRecvCount = parseInt(mailCfg.mailReceiverCount/that.maxWorker)

        for (let ii = 0; ii < that.maxWorker; ii++) {
            let worker = {}
            let mailCfgAss = {}
            Object.assign(mailCfgAss, mailCfg)
            worker.worker = cluster.fork()
            mailCfgAss.mailSenderStart = eachSendCount * ii + mailCfg.mailSenderStart
            mailCfgAss.mailSenderCount = eachSendCount
            mailCfgAss.mailReceiverStart = eachRecvCount * ii + mailCfg.mailReceiverStart
            mailCfgAss.mailReceiverCount = eachRecvCount

            if (ii == that.maxWorker -1 ) {
                mailCfgAss.mailReceiverCount = mailCfg.mailReceiverCount - eachRecvCount * (ii)
            }
            worker.mailCfg = mailCfgAss
            this.workers.push(worker)
        }
        let backServ = new BackendServer(mailCfg.backServerPort);
        backServ.setGetSuccessFun(async ()=> {
            that.waitList = []
            let waitCount  = 0;
            const maxWait = 20;
            for (let ii = 0; ii < that.workers.length; ii++) {
                that.workers[ii].worker.send({cmd:BulkWebMailCluster.messageCmd.messageCmdOutSuccReq})
            }
            while (that.waitList.length < that.maxWorker && waitCount < maxWait) {
                await that.sleep(500)
                waitCount++
            }
            
            let totalCount = 0;
            let outputHtml = ''
            for (let ii = 0; ii < that.waitList.length; ii++) {
                for (let jj = 0; jj < that.waitList[ii].content.length; jj++) {
                    //  list of {sender:xxx, receiver:xxx} 
                    outputHtml += `<br> ${that.waitList[ii].content[jj].sender}  to:  ${that.waitList[ii].content[jj].receiver}</br>`
                    totalCount++;
                }
            }
            outputHtml = `<h1> 总共发出 ${totalCount} 封</h1>` + outputHtml
            return outputHtml
        });

        backServ.setGetSenderStatFun(async ()=>{
            that.waitList = []
            let waitCount  = 0;
            const maxWait = 20;
            for (let ii = 0; ii < that.workers.length; ii++) {
                that.workers[ii].worker.send({cmd:BulkWebMailCluster.messageCmd.messageCmdSenderReq})
            }
            while (that.waitList.length < that.maxWorker && waitCount < maxWait) {
                await that.sleep(500)
                waitCount++
            }
            let outputHtml = ''
            let index = 0;
            let totalSuccess =0 , totalFail = 0;
            for (let ii = 0; ii < that.waitList.length; ii++) {
                for (let jj = 0; jj < that.waitList[ii].content.length; jj++) {
                    index++
                    let succRate = 0;
                    if (that.waitList[ii].content[jj].usedCount == 0) {
                        succRate = -100;
                    } else {
                        succRate = that.waitList[ii].content[jj].succDeliver * 100 /that.waitList[ii].content[jj].usedCount;
                    }

                    outputHtml += `<br> ${index}: ${that.waitList[ii].content[jj].address} ` + 
                                `${that.waitList[ii].content[jj].usedCount} ${that.waitList[ii].content[jj].succDeliver} ${succRate}</br>`    
                    outputHtml += `<br> success: `
                    for (let kk = 0; kk < that.waitList[ii].content[jj].succList.length; kk++) {
                        outputHtml += `${that.waitList[ii].content[jj].succList[kk]} `
                        totalSuccess++;
                    }
                    outputHtml += `</br>`;
                    outputHtml += `<br> failed: `
                    for (let kk = 0; kk < that.waitList[ii].content[jj].failList.length; kk++) {
                        outputHtml += `${that.waitList[ii].content[jj].failList[kk]} `
                        totalFail++;
                    }
                    outputHtml += `</br>`;
                }
            }
            outputHtml = `<h1> totalSend: ${totalSuccess + totalFail} totalSuccess: ${totalSuccess} </h1>` + outputHtml;
            return outputHtml

        })
        backServ.setGetLeftSendFun(async ()=>{
            that.waitList = []
            let waitCount  = 0;
            const maxWait = 20;
            for (let ii = 0; ii < that.workers.length; ii++) {
                that.workers[ii].worker.send({cmd:BulkWebMailCluster.messageCmd.messageCmdLeftSendReq})
            }
            while (that.waitList.length < that.maxWorker && waitCount < maxWait) {
                await that.sleep(500)
                waitCount++
            }
            let outputHtml = ''
            let totalLeft = 0;
            for (let ii = 0; ii < that.waitList.length; ii++) {
                totalLeft+= that.waitList[ii].content.length
                for (let jj = 0; jj < that.waitList[ii].content.length; jj++) {
                    outputHtml += `<br> ${that.waitList[ii].content[jj]} </br>`
                }
            }
            outputHtml = `<h1> totalLeft: ${totalLeft}  </h1>` + outputHtml;
            return outputHtml
        })
        
        backServ.run();        
        // spread the mail sending work to each worker 
    
        cluster.on('online', function(worker) {
            logger.info('worker ' + 'id ' + worker.id + ' pid: ' + worker.process.pid + ' online')
            if (worker.id >  that.maxWorker) {
                logger.error(`workid ${worker.id} exceed the max cores ${ that.maxWorker}`)
            }

        })

        cluster.on('message', function(worker, message) {
            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdOutSuccRes) {
                that.waitList.push(message)
            }
            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdSenderRes) {
                that.waitList.push(message)
            }
            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdLeftSendRes) {
                that.waitList.push(message)
            }

        })

        cluster.on('exit', function(worker, code, signal) {
            logger.info('workder ' + worker.process.pid + ' died with code: ' + code + ', and signal: ' + signal)
        })
    }

    setUpWorkExecute(cluster) {
        let numCores = require('os').cpus().length
        let that = this;
        that.maxWorker = mailCfg.nodeCluster.maxCore
        if (that.maxWorker > numCores || that.maxWorker == 0) {
            that.maxWorker = numCores;
        }
        let eachSendCount = parseInt(mailCfg.mailSenderCount /that.maxWorker)
        let eachRecvCount = parseInt(mailCfg.mailReceiverCount/that.maxWorker)

        let mailCfgAss = {}
        let index = cluster.worker.id -1
        Object.assign(mailCfgAss, mailCfg)
        mailCfgAss.mailSenderStart = eachSendCount * index + mailCfg.mailSenderStart
        mailCfgAss.mailSenderCount = eachSendCount
        mailCfgAss.mailReceiverStart = eachRecvCount * index + mailCfg.mailReceiverStart
        mailCfgAss.mailReceiverCount = eachRecvCount

        if (cluster.worker.id == that.maxWorker) {
            mailCfgAss.mailReceiverCount = mailCfg.mailReceiverCount - eachRecvCount * (that.maxWorker - 1)
        }

        // setup the BulkWebMailMana, but don't run it until 10 seconds 
        let mailWorker = new BulkWebMailMana()
        that.mailWorker = mailWorker
        setTimeout(()=>{
            that.mailWorker.runWebMailLoop(mailCfgAss);
        }, 10000* index)

        process.on('message', (message) => {
            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdOutSuccReq) {
               logger.info(`worker ${cluster.worker.id } receiver message messageCmdOutSuccReq`)
               let outList = that.mailWorker.successMailOut();        
               process.send({cmd:BulkWebMailCluster.messageCmd.messageCmdOutSuccRes,
                               content:outList})                   
            }

            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdSenderReq) {
                logger.info(`worker ${cluster.worker.id } receiver message messageCmdSenderReq`)
                let outList =  that.mailWorker.mailSenderStatOut();
                process.send({cmd:BulkWebMailCluster.messageCmd.messageCmdSenderRes,
                    content:outList})                 
            }

            if (message.cmd == BulkWebMailCluster.messageCmd.messageCmdLeftSendReq) {
                logger.info(`worker ${cluster.worker.id } receiver message messageCmdLeftSendReq`)
                let outList =  that.mailWorker.mailLeftSendOut();
                process.send({cmd:BulkWebMailCluster.messageCmd.messageCmdLeftSendRes,
                    content:outList}) 

            }
  
        })

    }
}


function setupWebMailCluster() {
    var args = process.argv
    // use the specified  config file 
    if (args.length > 2) {
        try {
            let cfgFile = args[2]
            let rawdata = fs.readFileSync(cfgFile);
            let mailLoadCfg = JSON.parse(rawdata);
            mailCfg = mailLoadCfg
            logger.error(`use config file ${cfgFile}`)
        }catch(e) {
            logger.error(e)
        }
    }
    let mailCluster = new BulkWebMailCluster();
    if (cluster.isMaster) {
        mailCluster.setupBulkWebMailWorkerProcess()
    }else {
        mailCluster.setUpWorkExecute(cluster)

    }

}

setupWebMailCluster()