const HttpsProxyAgent = require('https-proxy-agent');
const request = require('request');
const logger = require('./logger.js');
const http = require('http')
const rest 	 = require('restler-base')
//const logger = console;

class PeaProxy {
	constructor(...args) {
        let [apiId, apiKey, whiteIpIndex] = args;
        this.apiId = apiId;
        this.apiKey = apiKey;
        this.whiteIpIndex = whiteIpIndex;
        this.proxyIps = [];
        this.eachReqCount = 10;  // request count each time
        this.refreshperiod = 3000;  // 
        this.refreshTimer = null;
        this.sweepProceedTime = 60; 
        this.prePublicIp = ''
        this.whiteIpId = ''  // 
    }
    
    sweepTimeoutProxys() {
        let nowtime = Date.now();
        while(this.proxyIps.length >0) {
            if (nowtime + this.sweepProceedTime * 1000 - this.proxyIps[0].expiretime >= 0) {
                this.proxyIps.shift();
            }else {
                break;
            }
        }
    }

    beginFreshTimer() {
        let that = this;
        if (this.refreshTimer != null) {
            return;
        }
        logger.error('开始刷新定时器');
        this.refreshTimer = setInterval(()=>{
            logger.error('刷新定时器超时');
            that.periodRefresh();
        }, this.refreshperiod*1000)

    }

    periodRefresh() {
        this.sweepTimeoutProxys();
        this.doGetProxyIps();
    }

    getAuthenProxyIpStrs(count , msg) {
        this.doGetAuthenProxyIpStrs(count).then((data)=> {
            if (!data || data.length == 0) {
                logger.error('获取代理信息失败')
                msg.error(data);
            }else {
                msg.success(data);
            }
    
        })           
    }

    async doGetAuthenProxyIps(count) {
        let proxyips = [];
        
        if (this.proxyIps.length >= count) {
            for (let ii = 0; ii < count; ii++) {
                let useIp = this.proxyIps.pop();
                proxyips.push(useIp)
            }
            return proxyips;
        }
        await this.doGetProxyIps(this.eachReqCount);

        if (this.proxyIps.length >= count) {
            for (let ii = 0; ii < count; ii++) {
                let useIp = this.proxyIps.pop();
                proxyips.push(useIp)
            }
            return proxyips;           
        }else {
            logger.error(`取到的代理不够满足请求 需要:${count} 存在:${this.proxyIps.length}`)
        }
        return proxyips;
    }

    async doGetAuthenProxyIpStrs(count) {
        let proxyipstrs = [];
        
        if (this.proxyIps.length >= count) {
            for (let ii = 0; ii < count; ii++) {
                let useIp = this.proxyIps.pop();
                proxyipstrs.push(`${this.apiId}:${this.apiKey}@${useIp[ii].ip}:${useIp[ii].port}`);
            }
            return proxyipstrs;
        }
        await this.doGetProxyIps(this.eachReqCount);

        if (this.proxyIps.length >= count) {
            for (let ii = 0; ii < count; ii++) {
                let useIp = this.proxyIps.pop();
                proxyipstrs.push(`${this.apiId}:${this.apiKey}@${useIp[ii].ip}:${useIp[ii].port}`);
            }
            return proxyipstrs;           
        }else {
            logger.error(`取到的代理不够满足请求 需要:${count} 存在:${this.proxyIps.length}`)
        }
        return proxyipstrs;
    }
    /*
    app_key	string	True	后台生成的app_key(点击前往),用户登陆情况下浏览器访问本接口不需要传,其他情况必传
    num	int	True	需要获取的IP数量,取值范围1~100（默认：1）
    port	int	True	端口位数,当前支持: 3位4位5位端口（默认：随机端口）
    xy	int	True	协议类型,http/https: 1; scoks5: 3（默认：1）
    type	int	False	返回类型,txt: 1,json: 2（默认：2）
    lb	string	False	txt返回格式的分割符号,当前支持'\r\n','\r','\n','\t'
    mr	int	Flase	去重间隔,360天去重: 1; 当日去重: 2; 不去重: 3（默认：3）   
    http://api.wandoudl.com/api/ip?app_key=3dc79628fe1a2866c29bbdfb4ec7395b&pack=0&num=20&xy=1&type=2&lb=\r\n&mr=1& 
    */
    async doGetProxyIps(count) {
        let that = this;
        let requesUrl = 'http://api.wandoudl.com/api/ip';
        requesUrl += `?app_key=${that.apiKey}&num=${count}&xy=1&type=2&lb=\r\n&mr=1&`;
        let iplist = [];
        let data = await that.doRequest({
            url: requesUrl,
            method: 'GET'
        })
        if (data) {
            // logger.info(data)
            let jsonResult =  JSON.parse(data)
            if (!jsonResult) {
                logger.error('返回结果出错')
                return iplist;
            }
            
            jsonResult.code = jsonResult.code || '';
            if (jsonResult.code != '200') {
                logger.error(`返回错误， 错误码  ${jsonResult.code} ${jsonResult.msg}`);
                return iplist;
            }

            jsonResult.data = jsonResult.data || '';
            // logger.info(jsonResult.data)
            if (jsonResult.data === '') {
                logger.error('没有ip 返回');
                return iplist;
            }
            // logger.info(jsonResult)
            try {
                for (let ii = 0; ii < jsonResult.data.length; ii++) {
                    let objip = {
                        ip:  jsonResult.data[ii].ip,
                        port: jsonResult.data[ii].port,
                        time: Date.now(),
                        expiretime: Date.parse(jsonResult.data[ii].expire_time)
                    }
                    iplist.push(objip);
                    this.proxyIps.push(objip);
                }
            }
            catch(e) {
                logger.error('解析ip列表出错');
                logger.error(e)
            }
            if (!this.refreshTimer) {
                // this.beginFreshTimer();
            }
            return iplist;
            
        }else {
            logger.error('doGetProxyIps 没有结果返回')
        }          
        return iplist
    }

    async doGetSelfPublicIp() {
        const url = 'http://txt.go.sohu.com/ip/soip'
        return new Promise((resolve, reject)=> {
            http.get(url, res => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    let m = data.match(/\d+\.\d+\.\d+\.\d+/g)
                    if (m.length > 0) {
                        resolve({res:"ok", ip:m[0]})
                    }
                })
            }).on('error', e => resolve({res:"error"}))
        })
    }
    async init() {
        let bindId = await this.doGetBindIpId()
        if (bindId == undefined) {
            logger.error('无法获取代理绑定IP ID')
            return;
        }
        logger.info(`获取到代理IP id ${bindId}`)
        this.whiteIpId = bindId;
        await this.doBindClientIp();
        this.startBindClientIpTimer()
    }
    startBindClientIpTimer() {
        let that = this;
        setInterval(()=> {
            that.doBindClientIp()
        },  60*60*1000) // check the IP every one hour
    }   
    /* totally can bind 5 public IPs, get the IP id based on the config whiteIpIndex*/
    async doGetBindIpId() {
        let that = this;
        let requesUrl = 'http://api.wandoudl.com/api/whitelist/list';
        let iplist = [];
        let data = await that.doRequest({
            url: requesUrl,
            method: 'POST',
            params: {
                app_key: that.apiKey
            }
        })
        if (data) {
            // logger.info(data)
            let jsonResult =  JSON.parse(data)
            if (!jsonResult) {
                logger.error('获取绑定iplist, 返回结果出错')
                return ;
            }
            
            jsonResult.code = jsonResult.code || '';
            if (jsonResult.code != '200') {
                logger.error(`获取绑定iplist返回错误， 错误码  ${jsonResult.code} ${jsonResult.msg}`);
                return ;
            }

            jsonResult.data = jsonResult.data || '';
            // logger.info(jsonResult.data)
            if (jsonResult.data === '') {
                logger.error('没有ip 返回');
                return ;
            }
            // logger.info(jsonResult)
            try {
                if (jsonResult.data.length == 0) {
                    logger.error(`没有绑定ip返回`)
                    return;
                }
                if (this.whiteIpIndex > jsonResult.data.length) {
                    logger.error(`白名单index${this.whiteIpIndex } 超过绑定个数${ jsonResult.data.length}`)
                    return;
                }
                return jsonResult.data[this.whiteIpIndex -1].id;
            }
            catch(e) {
                logger.error('解析绑定ip列表出错');
                logger.error(e)
            }
            return ;
            
        }else {
            logger.error('doGetBindIpId 没有结果返回')
        }          
        return 
    }

    async doBindClientIp() {
        let that = this;
        let {res, ip} = await this.doGetSelfPublicIp()
        if (res == 'error') {
            logger.error(`获取公网IP失败`)
            return
        }
        if (this.prePublicIp == ip) {
            logger.info('public IP not change')
            return;
        }
        this.prePublicIp = ip;
        logger.info(`bind ip ${ip}`)
        let requesUrl = 'http://api.wandoudl.com/api/whitelist/update';
        requesUrl += `?app_key=${that.apiKey}&id=${this.whiteIpId}&ip=${ip}`;
        let data = await that.doRequest({
            url: requesUrl,
            method: 'GET'
        })
        if (data) {
            let jsonResult =  JSON.parse(data)
            if (!jsonResult) {
                logger.error('绑定IP，解析返回结果出错')
                return ;
            }
            
            jsonResult.code = jsonResult.code || '';
            if (jsonResult.code != '200') {
                logger.error(`绑定IP返回错误， 错误码  ${jsonResult.code} ${jsonResult.msg}`);
                return ;
            }
        }else {
            logger.error('绑定IP 没有结果返回')
        }          
        
    }

	async doRequest(msg) {
		let data = null;
		if(msg != null) {
			// get方法
			if(msg.method == "GET") {
				try {
					data = await this.synchronous_get(msg.url, msg.proxy);
                    return data.body;
				} catch(err) {

				}
			// post方法
			} else if(msg.method == "POST") {
				try {
                    // logger.info(msg)
					data = await this.synchronous_post_rest(msg.url, msg.params, msg.proxy);
					return data;
				} catch(err) {

				}
			}
		}
	}    

    synchronous_post_rest(reqUrl, params,proxy) {
		return new Promise((resolve, reject)=> {
			rest.post(reqUrl, {
				multipart: true,
				data:params,
				headers: { 
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
					'Content-Type' : 'application/x-www-form-urlencoded' 
				}
			}).on('complete', function(data) {
                // logger.info(data)
                resolve(data)
                
			});
		})        
    }

	synchronous_post(reqUrl, params,proxy) {
		let options = {
			url: reqUrl,
			method: "POST",
            body: params,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
                'Content-Type' : 'application/x-www-form-urlencoded' 
            }            
		};
		if (proxy) {
			console.log("当前代理ip: "+proxy)
			options.proxy = proxy;
        }
        logger.info(options)
		return new Promise(function(resolve, reject) {
			request(options, function(error, response, body) {
				if(error || response.statusCode != 200) {
					reject({
						error,
						response
					});
				} else {
                    
					resolve({
						body
					});
				}
			});
		});
	}


	synchronous_get(reqUrl, proxy=null) {
		let options = {
			url: reqUrl,
            method: "GET",
        };
        
        if (proxy != null && proxy != undefined) {
            options.proxy = proxy
        }

		return new Promise(function(resolve, reject) {
			request(options, function(error, response, body) {
				if(error || response.statusCode != 200) {
					reject({
						error,
						response
					});
				} else {
					resolve({
						body
					});
				}
			});
		});
    }
 
    sleep (time = 0) {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(-2)
          }, time)
        })
      }  

    banTimeout (args, ms = 10 * 1000) {
        args.push(this.sleep(ms))
        return Promise.race(args)
    }

    async testProxyAvailable(proxyIp) {
        let requestUrl = 'https://baidu.com'

        let data = await this.banTimeout([
            this.doRequest({
                url: requestUrl,
                method: 'GET',
                proxy:proxyIp
            })
        ], 7000)
        if (data) {
            // console.log(data)
            if (data == -2) {
                return null;
            }
            
            return data;
        }else {
            logger.error('doGetProxyIps 没有结果返回')
            return null
        }   
    }
}

if(__filename === process.mainModule.filename) {
    (async ()=> {
        peaProxy = new PeaProxy();
        await peaProxy.testProxyAvailable('http://60.166.74.4:5412')

    })()
 
}

module.exports =  PeaProxy