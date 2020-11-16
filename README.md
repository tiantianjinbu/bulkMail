# bulkMail
基于puppeteer的126， 163 邮箱批量登录，发送邮件程序。支持多核并发，puppeteer并发, 自动验证码(需要接入打码平台),邮箱cookie转存，cookie登录， 批量发送，发送结果检查。
作者声明：本代码仅供技术学习和交流，请勿用本代码或在本代码基础上改动代码进行违法活动。



## 1 批量登录:
node BulkLoginCluster.js

配置文件 maillogincfg.json设置说明
```
{
    "proxy":{                                           -- 豌豆代理设置，  https://h.wandouip.com/
        "useProxy":false,                               -- 是否使用代理ip来进行邮箱登录,获取cookie
        "proxyApiKey":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  -- apiKey
		"whiteIpIndex":3                                   -- ip白名单index
    },
	"chaoJiYing":{                                      --- 超级鹰识别设置， 详见  http://www.chaojiying.com/
		"user":"xxxxxxxxx",
		"password":"xxxxxxxxx",
		"softid":"xxxxxxx"
	},
	"maxLoginCountEachIp":15,                           ---当使用代理来登陆邮箱时，每个代理ip最大登陆邮箱个数                     
	"mailSenderFile":{                                  ---发件箱资源， 文件格式参见126新1.txt
		"filename":"./126新1.txt",
		"webType":"126"
	},
	"puppeteer":{                                       --- puppeteer 设置
		"maxConcurrency":1,                             --- puppeteer 并发数
		"timeout":90000,                                --- 网页操作超时时间              
		"headless":false                                --- 是否开启无头显示
	},
	"mongoCfg": {                                       --- cookie获取后存入的mongo db数据库配置
		"ip":"127.0.0.1",
		"port":"27017"
	},	
	"nodeCluster":{                                     --- 程序多核并发配置
		"maxCore":1
	},
	"backServerPort":4000,                              --- 运行结果前端展示端口号
	"authReCheck":true
}
```

## 2 发送邮件
node BulkWebMailCluster.js
配置文件 mailcfg.json 设置说明
```
{
    "mailSenderFile": "./163手机1万.txt",               --- 废弃， 发件箱资源从存取到mongo db里面的cookie中获取
    "mailSenderStart": 1,                               --- 发件箱开始index
    "mailSenderCount": 13,                              --- 利用发件箱个数
    "mailReceiverFile": "./收件箱.txt",                 --- 要发送的所有收件箱
    "mailReceiverStart":100,                            --- 收件箱开始index
    "mailReceiverCount":13,                             --- 要发送的收件箱个数
    "mailReceiverTestFile": "./邮箱自测.txt",           --- 自测收件箱列表文件
    "mailReceiverTestStart":1,                          --- 自测收件箱开始index
    "mailReceiverTestCount":3,                          --- 自测收件箱个数
    "mailVariableFile":"./邮箱变量.txt",                
    "mailVariableNeed":true,
    "mailImageFile":"./p21.jpeg",                       --- 废弃
    "mailTempleteFile":"./mailTemplete.txt",            --- 废弃
    "mailImageNeed":false,                              --- 废弃
    "mailPlainText":false,                              --- 废弃
	"mailAccountMaxParallel":6,                         --- 最大同时并发发送的发件箱个数
	"mailAccountMaxEachSend":3,                         --- 每个发件箱每次最大发送个数
	"mailAccountMaxTotalSend":10,                       --- 每个发件箱最多发送次数
	"waitTimeEachSend":5000,
	"backServerPort":3000,                              ---  前端展示端口号     
	"mongoCfg": {                                       --- mongo db 
		"ip":"127.0.0.1",
		"port":"27017"
	},
	"chaoJiYing":{                                      --- 超级鹰识别设置， 详见  http://www.chaojiying.com/
		"user":"xxxxxxxxx",
		"password":"xxxxxxxxx",
		"softid":"xxxxxxx"
	},	
    "proxy":{                                           --- 豌豆代理设置   https://h.wandouip.com/
        "useProxy":true,
        "proxyApiKey":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		"whiteIpIndex":3
    },
	"puppeteer":{                                       --- puppeteer 设置
		"maxConcurrency":1,
		"timeout":90000,
		"headless":true
	},
	"nodeCluster":{                                     --- 程序多核并发配置
		"maxCore": 1
	},
	"mailContentList": [                                --- 发送内容设置，从列表中随机抽取一个发送
		{
		"mailSubject":"哈哈",                           --- 主题
		"mailContent":"哈哈",                           --- 内容
		"mailImage":""                                  --- 要发图片的话，需要填图片的url路径
		},
		{
		"mailSubject":"呵呵",
		"mailContent":"呵呵",
		"mailImage":""
		},
		{
		"mailSubject":"",
		"mailContent":"",
		"mailImage":""
		},
		{
		"mailSubject":"",
		"mailContent":"",
		"mailImage":""
		},
		{
		"mailSubject":"",
		"mailContent":"",
		"mailImage":""
		}
	]
  }
```

## 3 测试一个邮件用cookie发信
node WebMail.js sendMail xxxxxxxxxx@163.com


## 4 删除超时的cookie记录
node WebMail.js delTimeout




