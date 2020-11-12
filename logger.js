"use strict"

// 引入 log4js 模块
const log4js = require('log4js');

// 系统模块
const path = require('path');

const log4jConfig = require('./log4j.js');

// 日志输出适配类
class logger {
	
	constructor() {
		// 读取配置文件
		// let log4jConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config/log4j.json"), 'utf-8').toString());
		try {
			// 更改日志保存路径
			log4jConfig.appenders.console.filename = path.resolve(__dirname, "../logs/console-" + process.pid + ".log");
			// 加载日志配置文件
			log4js.configure(log4jConfig);
			// 调试信息
			//this.logDebug = log4js.getLogger("##");
			// 结果信息
			this.logResult = log4js.getLogger("**");
			// 日志信息
			this.logInfo = log4js.getLogger("@@");
		} catch(e) {
			// 结果信息
			this.logResult = console;
			// 日志信息
			this.logInfo = console;
		}
	}
	
	debug(msg) {
		//this.logDebug.debug(msg);
	}
	info(msg) {
		//this.logDebug.info(msg);
		this.logInfo.info(msg);
	}
	// 输出抢宝结果
	result(msg) {
		this.logInfo.info(msg);
		this.logResult.info(msg);
	}
	warn(msg) {
		//this.logDebug.warn(msg);
		this.logInfo.warn(msg);
	}
	error(msg) {
		//this.logDebug.error(msg);
		this.logInfo.error(msg);
	}
}

// 导出模块
module.exports = new logger();