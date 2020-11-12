const MongoClient = require('mongodb').MongoClient;
const logger = require('./logger.js');
class CookieManager {
    constructor() {
        this.mongoDb = null;
        this.mongoDbName  = 'bulkmail'
        this.mongoCollName = 'cookie'
        this.mongoColAccountName = 'userAccount'
        this.mongoColCookieAssoName = 'cookieAsso'        
        this.mongoUrl = 'mongodb://localhost:27017/'
        this.CookieAssoMaxHis = 10 

    }

    async initConnect(mongoUrl='') {
        var url = mongoUrl;
        if (mongoUrl == '') {
            url = this.mongoUrl;
        }
        
        let that = this
        return new Promise((resolve, reject)=> {
            MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology:true }, function (err, db) {
                if (err) {
                    reject(err)
                }
                logger.info('数据库已创建');
                that.mongoDb = db.db(that.mongoDbName);
                if (!that.mongoDb.collection[that.mongoCollName]) {
                    that.mongoDb.createCollection(that.mongoCollName, function (err, res) {
                    });
                }
                if (!that.mongoDb.collection[that.mongoColAccountName]) {
                    that.mongoDb.createCollection(that.mongoColAccountName, function (err, res) {
                    });
                }
                if (!that.mongoDb.collection[that.mongoColCookieAssoName]) {
                    that.mongoDb.createCollection(that.mongoColCookieAssoName, function (err, res) {
                    });
                }
                resolve(0)   
            });
        })

    }

    async appendUserAccount(userName, webType, password, userState) {
        let whereStr = {'name':userName, 'webType': webType}
        let updateAccount = {$set:{'userState':userState}}
        let insertAccount = {'name':userName, 'webType': webType, 'password':password, 'userState':userState}
        let matchAccount = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoColAccountName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询账户 失败 user: ${userName}  type: ${webType}`)
        })

        if (matchAccount == undefined) {
            return;
        }

        if (matchAccount.length > 1) {
            logger.error(`error: 查询到${matchAccount.length} 个记录 `);

            await new Promise((resolve, reject)=> {
                this.mongoDb.collection(this.mongoColAccountName).deleteMany(whereStr, function(err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    }else {
                        console.log(obj.result.n + " 条文档被删除");
                        resolve(obj)
                    }
                });
            }).catch(e=>{
                logger.error(`删除账号失败 user: ${userName}  type: ${webType}`)
            })            
        }else if (matchAccount.length == 1) {
            await new Promise((resolve, reject) => {
                this.mongoDb.collection(this.mongoColAccountName).updateOne(whereStr, updateAccount, function (err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    } else {

                        resolve(obj)
                    }
                });
            }).catch(e => {
                logger.error(`更新账号失败 user: ${userName}  type: ${webType} err ${e}`)
            })               
        } else {
            await new Promise((resolve, reject) => {
                this.mongoDb.collection(this.mongoColAccountName).insertOne(insertAccount, function (err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    } else {

                        resolve(obj)
                    }
                });
            }).catch(e => {
                logger.error(`添加cookie失败 user: ${userName}  type: ${webType}`)
            }) 
        }        

    }

    async delUserAccount(userName, webType) {
        let whereStr = {'name':userName, 'webType': webType}
        await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoColAccountName).deleteMany(whereStr, function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`删除用户 失败 user: ${userName}  type: ${webType}`)
             
        })  

    }    

    async getUserAccount(userName, webType) {
        let whereStr = {'name':userName, 'webType': webType}
        let matchAccount = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoColAccountName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询用户 失败 user: ${userName}  type: ${webType}`)
        })    

        if (matchAccount == undefined) {
            return -1
        }
        if (matchAccount.length > 1) {
            logger.error(` user: ${userName}  type: ${webType} 个数 ${matchAccount.length}`)
            return -2
        }else if (matchAccount.length == 0){
            return 0;
        } else {
            return matchAccount[0];
        }
    }


/*
    async updateCookieState(userName, webType, state) {
        let whereStr = {'name':userName, 'webType': webType}
        let updageCookie = {$set:{'state':{'sendState':state, 'time':Date.now()}}}
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 user: ${userName}  type: ${webType}`)
            return;
        })

        if (matchCookie.length != 1) {
            logger.error(`error: 查询到${matchCookie.length} 个记录 `);
     
        }else {
            await new Promise((resolve, reject) => {
                this.mongoDb.collection(this.mongoCollName).updateOne(whereStr, updageCookie, function (err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    } else {

                        resolve(obj)
                    }
                });
            }).catch(e => {
                logger.error(`更新cookie失败 user: ${userName}  type: ${webType} err ${e}`)
                return;
            })               
        } 
    }
    */
    async appendCookieAssociate(userName, webType, cookieState=null, sendInfo=null) {
        let whereStr = {'name':userName, 'webType': webType}     
        let updateObj = {}
        let updateCookie = {}
        let sendInfoObj = {}

        if (cookieState == null && sendInfo == null) {
            return;
        }
        let matchCookieAssociate = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie Associate 失败 user: ${userName}  type: ${webType}`)
        })
        if (matchCookieAssociate == undefined) {
            return;
        }
        if (matchCookieAssociate.length != 1) {
            logger.error(`查询cookie: ${userName}  type: ${webType} length ${matchCookieAssociate.length}`)
            return;

        }

        if (cookieState != null) {
            updateObj.state = {'sendState': cookieState, 'time':Date.now()}
        }
        if (sendInfo != null) {
            sendInfoObj = {'sendInfo':sendInfo, 'time':Date.now()}
            if (matchCookieAssociate.length == 1 && matchCookieAssociate[0].sendInfoList != undefined) {
                updateObj.sendInfoList = matchCookieAssociate[0].sendInfoList
                updateObj.sendInfoList.splice(0, 0, sendInfoObj)
                if (updateObj.sendInfoList.length > this.CookieAssoMaxHis) {
                    updateObj.sendInfoList.splice(updateObj.sendInfoList.length -1, 1)
                }
            }else {
                updateObj.sendInfoList = [sendInfoObj]
            }

        }
        
        updateCookie = {$set: updateObj}

        await new Promise((resolve, reject) => {
            this.mongoDb.collection(this.mongoCollName).updateOne(whereStr, updateCookie, function (err, obj) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                } else {

                    resolve(obj)
                }
            });
        }).catch(e => {
            logger.error(`更新cookie associate 失败 user: ${userName}  type: ${webType} err ${e}`)
        })    
    
    }


    async appendCookieData(userName,  webType, cookieObj) {
        let whereStr = {'name':userName, 'webType': webType}
        let updageCookie = {$set:{'cookie':cookieObj}}
        let insertCookie = {'name':userName, 'webType': webType, 'time':Date.now(), 'cookie':cookieObj}
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 user: ${userName}  type: ${webType}`)
            return;
        })

        if (matchCookie == undefined) {
            return;
        }
        if (matchCookie.length > 1) {
            logger.error(`error: 查询到${matchCookie.length} 个记录 `);

            await new Promise((resolve, reject)=> {
                this.mongoDb.collection(this.mongoCollName).deleteMany(whereStr, function(err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    }else {
                        console.log(obj.result.n + " 条文档被删除");
                        resolve(obj)
                    }
                });
            }).catch(e=>{
                logger.error(`删除cookie失败 user: ${userName}  type: ${webType}`)
                return;
            })            
        }else if (matchCookie.length == 1) {
            await new Promise((resolve, reject) => {
                this.mongoDb.collection(this.mongoCollName).updateOne(whereStr, updageCookie, function (err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    } else {

                        resolve(obj)
                    }
                });
            }).catch(e => {
                logger.error(`更新cookie失败 user: ${userName}  type: ${webType} err ${e}`)
                
            })               
        } else {
            await new Promise((resolve, reject) => {
                this.mongoDb.collection(this.mongoCollName).insertOne(insertCookie, function (err, obj) { // 返回集合中所有数据
                    if (err) {
                        reject(err)
                    } else {

                        resolve(obj)
                    }
                });
            }).catch(e => {
                logger.error(`添加cookie失败 user: ${userName}  type: ${webType}`)
  
            }) 
        }        
    }

    async delCookie(userName, webType) {
        let whereStr = {'name':userName, 'webType': webType}
        await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).deleteMany(whereStr, function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`删除cookie 失败 user: ${userName}  type: ${webType}`)
        })  

    }

    async getTotalCookieCount() {
        let cookieCount = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find().count(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 个数 失败`)
        })       

        if (cookieCount == undefined) {
            return -1
        }

        return cookieCount;
    }

    async getCookieStateAndSendingHis(username, webType) {
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find({'name':username, 'webType':webType}, {'state':1, 'sendInfoList':1}).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 user: ${username}  type: ${webType}`)
        })       

        if (matchCookie == undefined) {
            return {'res':'error'}
        }

        let obj = {}
        Object.assign(obj, matchCookie[0])
        return {'res':'ok', 'sendInfoList':obj.sendInfoList}
    }
    async getCookieNameTypeList(start, count, filterCallback) {
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find({}, {'name':1, 'webType':1, 'state':1, 'sendInfoList':1}).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 `)
        })       

        if (matchCookie == undefined) {
            return -1;
        }

        let objList = []
        start = start % matchCookie.length;
        let validCount = 0;

        for (let ii = start;  ii < matchCookie.length + start; ii++) {
            let obj = {};
            let index = ii % matchCookie.length
            let filter = true;
            if (filterCallback != undefined) {
                filter = filterCallback(matchCookie[index])
            }
            if (filter == false) {
                continue;
            }
            obj.name = matchCookie[index].name;
            obj.webType = matchCookie[index].webType;
            if (matchCookie[index].state == undefined) {
                obj.state = undefined
            }else {
                obj.state =  matchCookie[index].state.sendState;
            }
            
            obj.sendInfoList = matchCookie[index].sendInfoList

            objList.push(obj)
            validCount++;
            if (validCount >= count) {
                break;
            }
        }
        return objList;
    }


    async getCookie(userName, webType) {
        let whereStr = {'name':userName, 'webType': webType}
        // let whereStr = {'name':userName}
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 user: ${userName}  type: ${webType}`)
        })       
        if (matchCookie == undefined) {
            return -1;
        }

        if (matchCookie.length > 1) {
            logger.error(`cookie user: ${userName}  type: ${webType} 个数 ${matchCookie.length}`)
            return -2
        }else if (matchCookie.length == 0){
            return 0;
        } else {
            return {'time':matchCookie[0].time, 'cookie':matchCookie[0].cookie}
        }
    }

    async getAllCookie() {
        let whereStr = {}
        // let whereStr = {'name':userName}
        let matchCookie = await new Promise((resolve, reject)=> {
            this.mongoDb.collection(this.mongoCollName).find(whereStr).toArray(function(err, result) { // 返回集合中所有数据
                if (err) {
                    reject(err)
                }else {
                    resolve(result)
                }
            });
        }).catch(e=>{
            logger.error(`查询cookie 失败 `)
        })       
        if (matchCookie == undefined) {
            return -1;
        }

        return matchCookie;
    }

}


module.exports = CookieManager