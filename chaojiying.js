/*
* 超级鹰 http 接口(上传)，node.js 示例代码  http://www.chaojiying.com/
* 注意：需要安装restler : npm install restler
*/

const rest 	 = require('restler-base')
const	fs   = require('fs')

class ChaoJiYing {
	constructor(user, pass, softid) {
		this.user = user;
		this.pass = pass;
		this.softid = softid;
	}

	async reportYidunError(picId) {
		let url = 'http://upload.chaojiying.net/Upload/ReportError.php'
		let sotfid = this.softid  //软件ID 可在用户中心生成

		return new Promise((resolve, reject)=> {
			rest.post(url, {
				multipart: true,
				data: {
					'user': this.user,
					'pass': this.pass,
					'softid': sotfid,
					'id': picId,
				},
				headers: { 
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
					'Content-Type' : 'application/x-www-form-urlencoded' 
				}
			}).on('complete', function(data) {
				resolve(data)
			});
		})

	}
	async getYidunVerifyCode(picName) {
		let url = 'http://upload.chaojiying.net/Upload/Processing.php'
		let sotfid = this.softid  //软件ID 可在用户中心生成
		let codeType = '9103'  //验证码类型 http://www.chaojiying.com/price.html 选择

		return new Promise((resolve, reject)=> {
			rest.post(url, {
				multipart: true,
				data: {
					'user': this.user,
					'pass': this.pass,
					'softid': sotfid,
					'codetype': codeType, 
					'userfile': rest.file(picName, null, fs.statSync(picName).size, null, 'image/gif') // filename: 抓取回来的码证码文件
				},
				headers: { 
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
					'Content-Type' : 'application/x-www-form-urlencoded' 
				}
			}).on('complete', function(data) {
				resolve(data)
			});
		})
	}


	async getYidunSliderVerifyCode(picName) {
		let url = 'http://upload.chaojiying.net/Upload/Processing.php'
		let sotfid = this.softid  //软件ID 可在用户中心生成
		let codeType = '9101'  //验证码类型 http://www.chaojiying.com/price.html 选择

		return new Promise((resolve, reject)=> {
			rest.post(url, {
				multipart: true,
				data: {
					'user': this.user,
					'pass': this.pass,
					'softid': sotfid,
					'codetype': codeType, 
					'userfile': rest.file(picName, null, fs.statSync(picName).size, null, 'image/gif') // filename: 抓取回来的码证码文件
				},
				headers: { 
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
					'Content-Type' : 'application/x-www-form-urlencoded' 
				}
			}).on('complete', function(data) {
				resolve(data)
			});
		})
	}	

	async getYidunTextRegCode(picName) {
		let url = 'http://upload.chaojiying.net/Upload/Processing.php'
		let sotfid = this.softid  //软件ID 可在用户中心生成
		let codeType = '1902'  //验证码类型 http://www.chaojiying.com/price.html 选择

		return new Promise((resolve, reject)=> {
			rest.post(url, {
				multipart: true,
				data: {
					'user': this.user,
					'pass': this.pass,
					'softid': sotfid,
					'codetype': codeType, 
					'userfile': rest.file(picName, null, fs.statSync(picName).size, null, 'image/gif') // filename: 抓取回来的码证码文件
				},
				headers: { 
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0',
					'Content-Type' : 'application/x-www-form-urlencoded' 
				}
			}).on('complete', function(data) {
				resolve(data)
			});
		})
	}		
}


if(__filename === process.mainModule.filename) {

(async function test_chaojiying() {
	let chaojiying = new ChaoJiYing('xxxxxxx', 'xxxxxxxx')   // change to correct user/pw
	let res = await chaojiying.getYidunVerifyCode('imageclip.png')
	console.log(res)
	if (res != 0) {
		res = await chaojiying.reportYidunError(res.pic_id)
	}
	
})()

}
module.exports = ChaoJiYing