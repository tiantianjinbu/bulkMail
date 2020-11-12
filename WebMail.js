/* eslint-disable no-undef */
const Puppeteer = require('puppeteer')
const ChaoJiYing = require('./chaojiying')
const fs = require('fs')
const CookieManager = require('./CookieManager')
const logger = require('./logger.js');

let WebMailType = {
  WebMailType126:1,
  WebMailType163:2,
}



class WebMail {
  
  static WebMailSendState = {
    WebMailSendStateUnKnown:0,
    WebMailSendStateNormal:1,    
    WebMailSendStateForbiden:2,           // Forbiden to send mail, can recover normal after 24 hours
    WebMailSendStateVerifyCodeSuccess:3,  // Need verify code to send mail, better not send mail in 24 hours
    WebMailSendStateVerifyCodeFail:4,     // Need verify code to send mail and fail to pass the verify, not send mail in 24 hours
    WebMailSendStateReject:5              // Rejected by the mailler
  }  

  static WebMailState = {
    WebMailStateUnKnown:0,
    WebMailStateAuth:1,         // Auth success
    WebMailStateAuthFail:2,     // Auth fail
    WebMailStateAuthFurther:3,  // Need further auth like sms code , etc. 
    WebMailStateInit:4,         // init 
    WebMailStateTimeout:5       // cookie expires, need re-login to fetch new cookie
  }

  setupChaoJiYing(user, password, softId) {
    this.chaoJiYingUser = user;
    this.chaoJiYingPw = password;
    this.chaoJiYingSoftId = softId;
  }

  async init(browser=true, mongoUrl = '') {
    this.loginExire = 0; 
    this.chaoJiYing = new ChaoJiYing(this.chaoJiYingUser, this.chaoJiYingPw)
    this.mailCookies = {}
    this.cookieMana = new CookieManager()
    this.cookieExpireTime = 3600*24*9.9 // second , lasting 10 days
    await this.cookieMana.initConnect(mongoUrl)
    // const browser = await puppeteer.launch({ignoreDefaultArgs: ["--enable-automation"]});
    if (browser) {
      this.browser = await Puppeteer.launch({
        headless: false,
        devtools: false,
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1920, height: 1080 },
        userDataDir: './userdata',
        // devtools:"true",
        // ignoreDefaultArgs: ["--enable-automation"],
        args: [
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-zygote',
          '--no-sandbox',
          '--disable-infobars',
          // '--proxy-server=36.26.207.84:766'
        ],
      });
    }

    return this.browser;
  }

  simMouseMovePosition(startP, endP) {
    let disX = endP.X - startP.X;
    let disY = endP.Y - startP.Y;
    let xStep = disX/5.0;
    let yStep = disY/5.0;
    let posList = [];

    for (let ii = 0; ii < 5; ii++) {
      let obj = {}
      obj.X = startP.X + xStep * ii + this.randomInt(4, 1)
      obj.Y = startP.Y + yStep * ii + this.randomInt(4, 1)
      posList.push(obj)
    }
    return posList;
  }

  async simMouseMove(mouse, startP, endP) {
    let posList = this.simMouseMovePosition(startP, endP)
    for (let ii = 0; ii < posList.length; ii++) {
      await mouse.move(posList[ii].X, posList[ii].Y)
      await this.sleep(this.randomInt(200, 50))
    }
  }


  sleep(time = 0) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, time)
    })
  }

  input_time_random() {
    return 200;

  }

  mail163CookieLoad(fileName, userName) {
    const fsFile = fs.readFileSync(fileName, 'utf-8')
    let jsonObj = JSON.parse(fsFile)
    this.mailCookies[userName] = jsonObj;
  }

  async mainSendMailFrom126UsingPage(page, username, toAddress, mailSubject,  mailContent, mailImage) {

    if (toAddress == '' || mailContent == undefined || mailContent == '' || mailSubject == '' || mailSubject == undefined) {
      return {state:'error', rescode:'param error'}
    }
    // 写信 button
    await page.evaluate(() => document.querySelector('.js-component-component.ra0.mD0').click());

    console.log('wait for email write button finish')

    // wait for mailto address input as waitForNavigation response error
    await page.waitForSelector('.nui-editableAddr-ipt')

    
    // mail to 
    await page.evaluate((text) => { (document.querySelector('.nui-editableAddr-ipt')).value = text; }, toAddress);

    // mail subject
    await page.evaluate((text) => { (document.querySelector('[id*="subjectInput"]')).value = text; }, mailSubject);
    // await page.evaluate(() => document.querySelector('[id*="_mail_button_2"]').click());

    // get mail content frame
    const framesall = await page.frames();
    let framecontent = null;
    for (let eachframe of framesall) {
      let content = await eachframe.content();
      if (content.indexOf('编辑邮件正文') > 0) {
        framecontent = eachframe;
        break;
      }
    }

    if (framecontent != null) {
      console.log('find content frame')
      await framecontent.evaluate((content) => {
        var div1 = document.createElement('div')
        div1.innerText = content
        document.body.appendChild(div1)
      }, mailContent)

      // Append image if mailImage path is not null
      if (mailImage != "" && mailImage != undefined) {
        await framecontent.evaluate((mailImage) => {
          var p1 = document.createElement('p')
          p1.style = "margin:0;"
          document.body.appendChild(p1)
  
          var image1 = document.createElement('img')
          image1.src = mailImage
          p1.appendChild(image1)
        }, mailImage)     
      }

      await page.evaluate(() =>
        document.querySelector('.js-component-icon.nui-ico.nui-ico-sent.nui-ico-sent-white').click())

      // check whether need setting the name
      let loopC = 0;
      while (loopC < 3) {
        let hasVeriry = true;
        // console.log('开始检查发送验证码')
        await page.waitForSelector('#imgMsgBoxVerify', { timeout: 5 * 1000 }).catch(e => {
          console.log(`没有发现验证码`);
          
          hasVeriry = false;
        })
        
        if (hasVeriry == false && loopC == 0) {
          // document.querySelectorAll('.js-component-msgbox.nui-msgbox')  禁言selector

          // might be forbiden , so do an aditional check 
          let needCheckForbiden = false;
          let needCheckName = false;
          let hasSetName = true;
          await page.waitForSelector('.js-component-link.je1', {timeout: 5* 1000}).catch(e => {
            logger.error(`${username} 需要检查设置发信姓名和发信禁止`)
            needCheckForbiden = true;
            needCheckName = true;
          })

          if (needCheckName) {
            await page.waitForSelector('.nui-msgbox-title', {timeout: 5* 1000}).catch(e => {
              logger.error(`${username} 没有设置姓名`)
              hasSetName = false;
            })           
          }
          

          if (hasSetName && needCheckName) {
            let setName = true
            await page.waitForSelector('.nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input', {timeout:5*1000}).catch(e=>{
              logger.error('没有发件人名称设置, 发信被禁止')
              setName = false;
            })

            if (setName) {
              // await page.evaluate((text) => 
                // { document.querySelector('.nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input').text = text}, username.split('@')[0])
                await page.type(".nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input", username.split('@')[0], {'delay': this.getRandomNum(100, 150) - 50})
                await  page.evaluate(()=> {document.querySelector('.nui-msgbox-ft .js-component-button.nui-mainBtn.nui-btn').click()})
            }else {
              logger.error(`${username} 用户被禁言`)
              return { state: 'error', rescode: WebMail.WebMailSendState.WebMailSendStateForbiden }
            }
            loopC++;
            continue;
          }          


          if (needCheckForbiden) {
            return {state: 'error', rescode: WebMail.WebMailSendState.WebMailSendStateForbiden}
          }

          await page.evaluate(() => { document.querySelectorAll('.js-component-link.je1')[1].click() })
          return { state: 'ok', rescode: WebMail.WebMailSendState.WebMailSendStateNormal }
        }else {
          let verifySuccess = true;
          if (loopC > 0) {
            await page.waitForSelector('.js-component-link.je1', {timeout: 5* 1000}).catch(e => {
              logger.error(`${username} 验证失败，继续...`)
              verifySuccess = false;
            })
            if (verifySuccess) {
              await page.evaluate(() => { document.querySelectorAll('.js-component-link.je1')[1].click() })
              return {state:'ok', rescode:WebMail.WebMailSendState.WebMailSendStateVerifyCodeSuccess}
            }
          }else {
            logger.info('发现发送验证码')
          }
        }
        await this.sleep(1000)
        let rect = await page.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('#imgMsgBoxVerify').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        logger.info(rect)
        await page.screenshot({
          "path": `./yidunpic/${username}_send.png`,
          "clip": {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top
          }
        })

        let res = await this.chaoJiYing.getYidunTextRegCode(`./yidunpic/${username}_send.png`)
        logger.info(res)
        if (res != 0) {
          // save money ?
          // console.log(res)
          await this.chaoJiYing.reportYidunError(res.pic_id)
          await page.evaluate((text) => { (document.querySelector('.nui-simpleForm.nui-form .nui-ipt-input')).value = text; }, res.pic_str);
          // await this.sleep(10000)
          await page.evaluate(() => document.querySelector('.nui-msgbox-ft-btns .js-component-button.nui-mainBtn.nui-btn').click());

        }
        loopC++
        
      }
      logger.error(`${username} 发送验证码识别失败`)
      return {state:'error', rescode:WebMail.WebMailSendState.WebMailSendStateVerifyCodeFail}
    }else {
      return {state:'error', rescode:WebMail.WebMailSendState.WebMailSendStateUnKnown}
    }
  }

  async mainSendMailFrom163UsingPage(page, username, toAddress, mailSubject,  mailContent, mailImage) {

    if (toAddress == '' || mailContent == undefined || mailContent == '' || mailSubject == '' || mailSubject == undefined) {
      return {state:'error', rescode:'param error'}
    }
    // 写信 button
    await page.evaluate(() => document.querySelector('.js-component-component.ra0.mD0').click());

    console.log('wait for email write button finish')

    // wait for mailto address input as waitForNavigation response error
    await page.waitForSelector('.nui-editableAddr-ipt')

    
    // mail to 
    await page.evaluate((text) => { (document.querySelector('.nui-editableAddr-ipt')).value = text; }, toAddress);

    // mail subject
    await page.evaluate((text) => { (document.querySelector('[id*="subjectInput"]')).value = text; }, mailSubject);
    // await page.evaluate(() => document.querySelector('[id*="_mail_button_2"]').click());

    // get mail content frame
    const framesall = await page.frames();
    let framecontent = null;
    for (let eachframe of framesall) {
      let content = await eachframe.content();
      if (content.indexOf('编辑邮件正文') > 0) {
        framecontent = eachframe;
        break;
      }
    }

    if (framecontent != null) {
      console.log('find content frame')
      await framecontent.evaluate((content) => {
        var div1 = document.createElement('div')
        div1.innerText = content
        document.body.appendChild(div1)
      }, mailContent)

      // Append image if mailImage path is not null
      if (mailImage != "" && mailImage != undefined) {
        await framecontent.evaluate((mailImage) => {
          var p1 = document.createElement('p')
          p1.style = "margin:0;"
          document.body.appendChild(p1)
  
          var image1 = document.createElement('img')
          image1.src = mailImage
          p1.appendChild(image1)
        }, mailImage)     
      }
 
      await page.evaluate(() =>
        document.querySelector('.js-component-icon.nui-ico.nui-ico-sent.nui-ico-sent-white').click())

      // check whether need setting the name
      let loopC = 0;
      while (loopC < 3) {
        let hasVeriry = true;
        // console.log('开始检查发送验证码')
        await page.waitForSelector('#imgMsgBoxVerify', { timeout: 5 * 1000 }).catch(e => {
          console.log(`没有发现验证码`);
          
          hasVeriry = false;
        })
        
        if (hasVeriry == false && loopC == 0) {
          // document.querySelectorAll('.js-component-msgbox.nui-msgbox')  禁言selector

          // might be forbiden , so do an aditional check 
          let needCheckForbiden = false;
          let needCheckName = false;
          let hasSetName = true;
          await page.waitForSelector('.js-component-link.je1', {timeout: 5* 1000}).catch(e => {
            logger.error(`${username} 需要检查设置发信姓名和发信禁止`)
            needCheckForbiden = true;
            needCheckName = true;
          })

          if (needCheckName) {
            await page.waitForSelector('.nui-msgbox-title', {timeout: 5* 1000}).catch(e => {
              logger.error(`${username} 没有设置姓名`)
              hasSetName = false;
            })           
          }

          if (hasSetName && needCheckName) {
            let setName = true
            await page.waitForSelector('.nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input', {timeout:5*1000}).catch(e=>{
              logger.error('没有发件人名称设置, 发信被禁止')
              setName = false;
            })

            if (setName) {
              // await page.evaluate((text) => 
                // { document.querySelector('.nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input').text = text}, username.split('@')[0])
                await page.type(".nui-simpleForm.nui-form .js-component-input.nui-ipt .nui-ipt-input", username.split('@')[0], {'delay': this.getRandomNum(100, 150) - 50})
                await  page.evaluate(()=> {document.querySelector('.nui-msgbox-ft .js-component-button.nui-mainBtn.nui-btn').click()})
            }else {
              logger.error(`${username}  用户被禁言`)
              return { state: 'error', rescode: WebMail.WebMailSendState.WebMailSendStateForbiden }
            }
            loopC++;
            continue;
          }          


          if (needCheckForbiden) {
            return {state: 'error', rescode: WebMail.WebMailSendState.WebMailSendStateForbiden}
          }

          await page.evaluate(() => { document.querySelectorAll('.js-component-link.je1')[1].click() })
          return { state: 'ok', rescode: WebMail.WebMailSendState.WebMailSendStateNormal }
        }else {
          let verifySuccess = true;
          if (loopC > 0) {
            await page.waitForSelector('.js-component-link.je1', {timeout: 5* 1000}).catch(e => {
              logger.error(`${username} 验证失败，继续...`)
              verifySuccess = false;
            })
            if (verifySuccess) {
              await page.evaluate(() => { document.querySelectorAll('.js-component-link.je1')[1].click() })
              return {state:'ok', rescode:WebMail.WebMailSendState.WebMailSendStateVerifyCodeSuccess}
            }
          }else {
            logger.info('发现发送验证码')
          }
        }
        await this.sleep(1000)
        let rect = await page.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('#imgMsgBoxVerify').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        logger.info(rect)
        await page.screenshot({
          "path": `./yidunpic/${username}_send.png`,
          "clip": {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top
          }
        })

        let res = await this.chaoJiYing.getYidunTextRegCode(`./yidunpic/${username}_send.png`)
        logger.info(res)
        if (res != 0) {
          // save money ?
          // console.log(res)
          await this.chaoJiYing.reportYidunError(res.pic_id)
          await page.evaluate((text) => { (document.querySelector('.nui-simpleForm.nui-form .nui-ipt-input')).value = text; }, res.pic_str);
          // await this.sleep(10000)
          await page.evaluate(() => document.querySelector('.nui-msgbox-ft-btns .js-component-button.nui-mainBtn.nui-btn').click());

        }
        loopC++
        
      }
      logger.error(`${username} 发送验证码识别失败`)
      return {state:'error', rescode:WebMail.WebMailSendState.WebMailSendStateVerifyCodeFail}
    }else {
      return {state:'error', rescode:WebMail.WebMailSendState.WebMailSendStateUnKnown}
    }
  }

  /*
    Check the mail Send result through checking the 已发送
    @input：  page  puppeteer opened page
              sendList  [{receiver, state}]
    @return:  {res,   sendResultList:[{receiver, state}]}

  */
 async checkMailFrom126SendResult(page, sendList) {

  // enter to the 已发送
  let findAlreadySend = false;
  let findSendLoop = 0;
  while (findSendLoop < 3) {
    await this.sleep(2000)
    findAlreadySend = await page.evaluate(() => {
      let itemList = document.querySelectorAll(".nui-tree-item-text")
      for (let ii = 0; ii < itemList.length; ii++) {
        if (itemList[ii].title == '已发送') {
          itemList[ii].click();
          return true;
        }
      }
      return false;
    })
    if (findAlreadySend) {
      break;
    }
    findSendLoop++;
  }

  if (!findAlreadySend) {
    logger.error(`checkMailFrom163SendResult 没有发现已发送按钮 `)
    await page.screenshot({
      "path": `./yidunpic/${sendList[0]}_check.png`
    })      
    return {res:'error'}
  }

  let loopCount = 0;
  while (loopCount < 5) {
    await this.sleep(2000) 
    // check each sending result of the sendList
    let sendResult = await page.evaluate((sendList)=> {
      let resultList = [];
      let receNameList = []
      let receiverList = document.querySelectorAll('.nl0.hA0.ck0 .gB0 .dP0')
      let stateList = document.querySelectorAll(".dT0.nui-ico.nui-ico-hasSub.nui-ico-mail")

      if (receiverList.length == 0 || stateList.length == 0) {
        return {res:'error'}
      }

      for (let jj = 0; jj < receiverList.length && jj < stateList.length; jj++) {
        receNameList.push(receiverList[jj].innerText)
      }


      for (let ii = 0; ii < sendList.length; ii++) {
        let obj = {} 
        obj.receiver = sendList[ii];
        obj.state = 'init';
        for (let jj = 0; jj < receiverList.length && jj < stateList.length; jj++) {
          if (sendList[ii].indexOf(receiverList[jj].innerText) != -1) {
            if (stateList[jj].title == "发送成功") {
              obj.state = 'success';
            }else if (stateList[jj].title == "发送不成功") {
              obj.state = 'reject';
            }else {
              obj.state = stateList[jj].title;
            }
            break;
          }
        }
        resultList.push(obj)
      }
      return {res:"ok", result:resultList, receiverLen:receiverList.length, stateLen:stateList.length, receiverList:receNameList}

    }, sendList)  
    // logger.error(`receiver len ${sendResult.receiverLen} statel len ${sendResult.stateLen} ${sendResult.receiverList}`)
    loopCount++;
    if (loopCount >= 5) {
      let hasInit = false;
      if (sendResult.res == 'ok') {
        for (let ii = 0; ii < sendResult.result.length; ii++) {
          if (sendResult.result[ii].state == 'init') {
            hasInit = true;
            break;
          }
        }
      }        
      if (hasInit || sendResult.res == 'error') {
        await page.screenshot({
          "path": `./yidunpic/${sendList[0]}_check.png`
        }) 
      }
      return sendResult;
    }
    if (sendResult.res == 'error') {
      continue;
    }

    let hasInit = false;
    if (sendResult.res == 'ok') {
      for (let ii = 0; ii < sendResult.result.length; ii++) {
        if (sendResult.result[ii].state == 'init') {
          hasInit = true;
          break;
        }
      }
    }
    if (!hasInit) {
      return sendResult;
    }

  }

}  

  /*
    Check the mail Send result through checking the 已发送
    @input：  page  puppeteer opened page
              sendList  [{receiver, state}]
    @return:  {res,   sendResultList:[{receiver, state}]}

  */
  async checkMailFrom163SendResult(page, sendList) {

    // enter to the 已发送
    let findAlreadySend = false;
    let findSendLoop = 0;
    while (findSendLoop < 3) {
      await this.sleep(2000)
      findAlreadySend = await page.evaluate(() => {
        let itemList = document.querySelectorAll(".nui-tree-item-text")
        for (let ii = 0; ii < itemList.length; ii++) {
          if (itemList[ii].title == '已发送') {
            itemList[ii].click();
            return true;
          }
        }
        return false;
      })
      if (findAlreadySend) {
        break;
      }
      findSendLoop++;
    }

    if (!findAlreadySend) {
      logger.error(`checkMailFrom163SendResult 没有发现已发送按钮 `)
      await page.screenshot({
        "path": `./yidunpic/${sendList[0]}_check.png`
      })      
      return {res:'error'}
    }

    let loopCount = 0;
    while (loopCount < 5) {
      await this.sleep(2000) 
      // check each sending result of the sendList
      let sendResult = await page.evaluate((sendList)=> {
        let resultList = [];
        let receNameList = []
        let receiverList = document.querySelectorAll('.nl0.hA0.ck0 .gB0 .dP0')
        let stateList = document.querySelectorAll(".dT0.nui-ico.nui-ico-hasSub.nui-ico-mail")
  
        if (receiverList.length == 0 || stateList.length == 0) {
          return {res:'error'}
        }
  
        for (let jj = 0; jj < receiverList.length && jj < stateList.length; jj++) {
          receNameList.push(receiverList[jj].innerText)
        }


        for (let ii = 0; ii < sendList.length; ii++) {
          let obj = {} 
          obj.receiver = sendList[ii];
          obj.state = 'init';
          for (let jj = 0; jj < receiverList.length && jj < stateList.length; jj++) {
            if (sendList[ii].indexOf(receiverList[jj].innerText) != -1) {
              if (stateList[jj].title == "发送成功") {
                obj.state = 'success';
              }else if (stateList[jj].title == "发送不成功") {
                obj.state = 'reject';
              }else {
                obj.state = stateList[jj].title;
              }
              break;
            }
          }
          resultList.push(obj)
        }
        return {res:"ok", result:resultList, receiverLen:receiverList.length, stateLen:stateList.length, receiverList:receNameList}
  
      }, sendList)  
      // logger.error(`receiver len ${sendResult.receiverLen} statel len ${sendResult.stateLen} ${sendResult.receiverList}`)
      loopCount++;
      if (loopCount >= 5) {
        let hasInit = false;
        if (sendResult.res == 'ok') {
          for (let ii = 0; ii < sendResult.result.length; ii++) {
            if (sendResult.result[ii].state == 'init') {
              hasInit = true;
              break;
            }
          }
        }        
        if (hasInit || sendResult.res == 'error') {
          await page.screenshot({
            "path": `./yidunpic/${sendList[0]}_check.png`
          }) 
        }
        return sendResult;
      }
      if (sendResult.res == 'error') {
        continue;
      }

      let hasInit = false;
      if (sendResult.res == 'ok') {
        for (let ii = 0; ii < sendResult.result.length; ii++) {
          if (sendResult.result[ii].state == 'init') {
            hasInit = true;
            break;
          }
        }
      }
      if (!hasInit) {
        return sendResult;
      }

    }

  }

  async login126WithCookieUsingPage(page, username, pwd)  {
      // const page = await this.browser.newPage()
      let url = 'https://mail.126.com';
      await this.pageRobotDefenseAttributeSet(page);
      let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType126)
      if (cookie == -1 || cookie == -2 || cookie == 0) {
        logger.error(`获取cookie 失败 ${username}`)
        return;
      }
      logger.info(`cookie 登录126 ${username}`)
      for (let ii = 0; ii < cookie.cookie.length; ii++) {
            // 163 and 126 uses cm_last_info to check whether to login with loginjustnow
            //  or verifycookie in order to do a 10 days no login
            // here just don't use this info
            if (cookie.cookie[ii].name == "cm_last_info") {
              continue;
                
            }          
          await page.setCookie(cookie.cookie[ii])
  
      }
  
      await page.goto(url)
      let cookieValid = true;
      await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
        console.log(`${username} cookie 失效`);
        cookieValid = false; 
      })

      if (cookieValid == false) {
        return;
      }
  
      let cookies = await page.cookies();
      // console.log(cookies)
      await this.cookieMana.appendCookieData(username, WebMailType.WebMailType126, cookies)  
      return page;     

  }

  async login163WithCookieUsingPage(page, username, pwd)  {
    // const page = await this.browser.newPage()
    let url = 'https://mail.163.com';
    await this.pageRobotDefenseAttributeSet(page);
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType163)
    if (cookie == -1 || cookie == -2 || cookie == 0) {
      logger.error(`获取cookie 失败 ${username}`)
      return;
    }
    logger.info(`cookie 登录163 ${username}`)
    for (let ii = 0; ii < cookie.cookie.length; ii++) {
          // 163 and 126 uses cm_last_info to check whether to login with loginjustnow
          //  or verifycookie in order to do a 10 days no login
          // here just don't use this info
          if (cookie.cookie[ii].name == "cm_last_info") {
            continue;
              
          }          
        await page.setCookie(cookie.cookie[ii])

    }

    await page.goto(url)
    let cookieValid = true;
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log(`${username} cookie 失效`);
      cookieValid = false; 
    })

    if (cookieValid == false) {
      return;
    }

    let cookies = await page.cookies();
    // console.log(cookies)
    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType163, cookies)  
    return page;     

}  
  async mainSendMailFrom126(username, pwd, mailToList, mailHeader,  mailSubject) {
    let page = await this.login126WithCookie(username, pwd)
    if (page == undefined) {
      return {state:'error', rescode:'logfail'}
    }
    await this.mainSendMailFrom126UsingPage(page, username, mailToList, mailHeader, mailSubject);
  }


  async mailCheckAccountValid(username, webType) {
    let account;
    if (webType == WebMailType.WebMailType126) {
      account = await this.cookieMana.getUserAccount(username, WebMailType.WebMailType126)
    }else {
      account = await this.cookieMana.getUserAccount(username, WebMailType.WebMailType163)
    }

    // not sure as no info, return valid
    if (account == 0 || account == -1 || account == -2) {
      return true;
    }
    if (account.userState == WebMail.WebMailState.WebMailStateAuthFail ||
      account.userState == WebMail.WebMailState.WebMailStateAuthFurther ) {
        return false;
    }
    return true;

  } 

  async mail126NeedLoginCheck(username, pwd, forceDel=false) {
    let ret = await this.mail126CookieCheck(username, pwd, forceDel)
    if (ret == WebMail.WebMailState.WebMailStateAuthFail || 
        ret == WebMail.WebMailState.WebMailStateAuthFurther ||
        ret == WebMail.WebMailState.WebMailStateAuth) {
          return {needCheck:false, cookieState:ret};
    }
    return {needCheck:true, cookieState:ret};
  }

  async mail163NeedLoginCheck(username, pwd, forceDel=false) {
    let ret = await this.mail163CookieCheck(username, pwd, forceDel)
    if (ret == WebMail.WebMailState.WebMailStateAuthFail || 
        ret == WebMail.WebMailState.WebMailStateAuthFurther ||
        ret == WebMail.WebMailState.WebMailStateAuth) {
          return {needCheck:false, cookieState:ret};
    }
    return {needCheck:true, cookieState:ret};
  }


  async mail126CookieCheck(username, pwd, forceDel=false) {
    if (forceDel) {
      await this.cookieMana.delCookie(username, WebMailType.WebMailType126)
    }
    let userValid = await this.mailCheckAccountValid(username, WebMailType.WebMailType126);
    if (!userValid) {
      return WebMail.WebMailState.WebMailStateAuthFail;

    }
    let statereturn;
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType126)
    if (cookie == -1 ) {
      logger.error(`获取cookie 失败 ${username}`)
      statereturn = WebMail.WebMailState.WebMailStateUnKnown;
    } else if (cookie == 0) {
      // logger.info(`${username} cookie 不存在`)

      statereturn = WebMail.WebMailState.WebMailStateInit;

    }else {
      let nowtime = Date.now();
      if (nowtime - cookie.time >= this.cookieExpireTime * 1000 || cookie == -2) {
        logger.info(`cookie ${username} 超时, 需要重新登录获取`)
        await this.cookieMana.delCookie(username, WebMailType.WebMailType126)

        statereturn = WebMail.WebMailState.WebMailStateTimeout
      }else {
        statereturn = WebMail.WebMailState.WebMailStateAuth
      }
    }
    return statereturn;

  }

  async mail163CookieCheck(username, pwd, forceDel=false) {
    if (forceDel) {
      await this.cookieMana.delCookie(username, WebMailType.WebMailType163)
    }
    let userValid = await this.mailCheckAccountValid(username, WebMailType.WebMailType163);
    if (!userValid) {
      return WebMail.WebMailState.WebMailStateAuthFail;
    }
    let statereturn;
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType163)
    if (cookie == -1 ) {
      logger.error(`获取cookie 失败 ${username}`)
      statereturn = WebMail.WebMailState.WebMailStateUnKnown;
    } else if (cookie == 0) {
      // logger.info(`${username} cookie 不存在`)
      statereturn =  WebMail.WebMailState.WebMailStateInit;

    }else {
      let nowtime = Date.now();
      if (nowtime - cookie.time >= this.cookieExpireTime * 1000 || cookie == -2) {
        logger.info(`cookie ${username} 超时, 需要重新登录获取`)
        await this.cookieMana.delCookie(username, WebMailType.WebMailType163)
        statereturn =  WebMail.WebMailState.WebMailStateTimeout;
      }else {
        statereturn = WebMail.WebMailState.WebMailStateAuth
      }
    }

    return statereturn;

  }

  async login126UseChromeCookie(username, pwd) {
    const context = await this.browser.createIncognitoBrowserContext();
    const page = await context.newPage();   
    // const page = await this.browser.newPage()
    let url = 'https://mail.126.com';
    await this.pageRobotDefenseAttributeSet(page);

    let buff = fs.readFileSync('cookie_from_chrome.txt', 'utf8')
    buff = buff.split("\r\n")
    let cookie = []

    for (let ii = 0; ii < buff.length; ii++) {
        let buffS = buff[ii].split('\t')
        if (buffS.length < 3) {
          continue;
        }
        let obj = {}
        obj.name = buffS[0]
        obj.value = buffS[1]
        obj.domain = buffS[2]
        cookie.push(obj)
    }

    logger.info(`cookie 登录126 ${username}`)
    for (let ii = 0; ii < cookie.length; ii++) {
      if (cookie[ii].name == "S_INFO" || 
          // eslint-disable-next-line no-empty
          cookie[ii].name == "df") {
            
          }


        await page.setCookie(cookie[ii])

    }

    await page.goto(url) 
    return page; 

  }
  // login to 126, and return the page, then the caller can continue the work based on the page
  async login126(username, pwd) {
    // first check if cookie existing
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType126)
    if (cookie == -1 ) {
      logger.error(`获取cookie 失败 ${username}`)
      return null;
    }    

    
    // not exist, try to login 
    if (cookie == 0) {
      // logger.info(`${username} cookie 不存在`)
      let {page, cookie} = await this.mailAccount126CookieFetch(username, pwd)
      if (cookie == null) {

        return null;
      }
      return page;
    }else { 
      let nowtime = Date.now();
      if (nowtime - cookie.time >= this.cookieExpireTime * 1000 || cookie == -2) {
        logger.info(`cookie ${username} 超时, 重新登录获取`)
        await this.cookieMana.delCookie(username, WebMailType.WebMailType126);
        let {page, cookie} = await this.mailAccount126CookieFetch(username, pwd)
        if (cookie == null) {
          return null
        }
        return page;
      }else {
        let page = await this.login126WithCookie(username, pwd)
        return page;
      }
    }    
  }

  async login163(username, pwd) {
    // first check if cookie existing
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType163)
    if (cookie == -1 ) {
      logger.error(`获取cookie 失败 ${username}`)
      return null;
    }    
    // not exist, try to login 
    if (cookie == 0) {
      let {page, cookie} = await this.mailAccount163CookieFetch(username, pwd)
      if (cookie == null) {
        return null;
      }
      // let page = await this.login163WithCookie(username, pwd)
      return page;
    }else { 
      let nowtime = Date.now();
      if (nowtime - cookie.time >= this.cookieExpireTime *1000 || cookie == -2) {
        logger.info(`cookie ${username} 超时, 重新登录获取`)
        await this.cookieMana.delCookie(username, WebMailType.WebMailType163);
        let {page, cookie} = await this.mailAccount163CookieFetch(username, pwd)
        if (cookie == null) {
          return null;
        }
        return page;
      }else {
        let page = await this.login163WithCookie(username, pwd)
        return page;
      }
    }
  }

  async login163WithCookie(username, pwd) {
    const context = await this.browser.createIncognitoBrowserContext();
    const page = await context.newPage();   
    let url = 'https://mail.163.com';
    await this.pageRobotDefenseAttributeSet(page);
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType163)
    if (cookie == -1 || cookie == -2 || cookie == 0) {
      logger.error(`获取cookie 失败 ${username}`)
      return;
    }
    

    for (let ii = 0; ii < cookie.cookie.length; ii++) {
      // 163 and 126 uses cm_last_info to check whether to login with loginjustnow
      //  or verifycookie in order to do a 10 days no login
      // here just don't use this info
      if (cookie.cookie[ii].name == "cm_last_info") {
        continue;

      }          
        await page.setCookie(cookie.cookie[ii])
    }

    await page.goto(url) 
    let cookieValid = true;
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log(`${username} cookie 失效`);
      cookieValid = false;
     
    })    
    if (cookieValid == false) {
      return;
    }
    let cookies = await page.cookies();
    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType163, cookies)      
    return page; 
  }

  async login126WithCookie(username, pwd) {
    const context = await this.browser.createIncognitoBrowserContext(
    );
    const page = await context.newPage();   
    // const page = await this.browser.newPage()
    let url = 'https://mail.126.com';
    await this.pageRobotDefenseAttributeSet(page);
    let cookie = await this.cookieMana.getCookie(username, WebMailType.WebMailType126)
    if (cookie == -1 || cookie == -2 || cookie == 0) {
      logger.error(`获取cookie 失败 ${username}`)
      return;
    }
    logger.info(`cookie 登录126 ${username}`)
    for (let ii = 0; ii < cookie.cookie.length; ii++) {
          // 163 and 126 uses cm_last_info to check whether to login with loginjustnow
          //  or verifycookie in order to do a 10 days no login
          // here just don't use this info
          if (cookie.cookie[ii].name == "cm_last_info") {
            continue;
              
          }          
        await page.setCookie(cookie.cookie[ii])

    }

    await page.goto(url)
    let cookieValid = true;
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log(`${username} cookie 失效`);
      cookieValid = false;
    })

    if (cookieValid == false) {
      return;
    }

    let cookies = await page.cookies();
    // console.log(cookies)
    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType126, cookies)  
    return page; 
  }  
  /*
  Set page attirbute in order to avoid the JS autorobot detect
  */
  async pageRobotDefenseAttributeSet(page) {

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36')


    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });


    await page.evaluate(
      '() =>{ Object.defineProperties(navigator,{ webdriver:{ get: () => false } }) }')
    await page.evaluate('() =>{ window.navigator.chrome = { runtime: {},  }; }')
    await page.evaluate("() =>{ Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); }")
    await page.evaluate("() =>{ Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5,6], }); }")

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

  // Pass the Permissions Test.
    await page.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query;
      return window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
  

  }

  async loginVerifyCodeFetchLoop(picFile) {
    let loopC = 0;
    while (loopC < 3) {
      let res = await this.chaoJiYing.getYidunVerifyCode(picFile)
      if (res != 0) {
        // save money ?
        console.log(res)
        await this.chaoJiYing.reportYidunError(res.pic_id)
        let posilist = res.pic_str.split('|')
        if (posilist.length == 3) {
          return res
        }
      }
      loopC++
    }
  }
  /*
  Try to login and get the cookie
  */
  async mailAccountCookieFetch(userName, pwd, webType) {
    if (webType == WebMailType.WebMailType163) {
      await this.mailAccount163CookieFetch(userName, pwd)
    }else if (webType == WebMailType.WebMailType126) {
      await this.mailAccount126cookieFetch(userName, pwd)
    }

  }
  
  async mailAccount163CookieFetchUsingPage(page, username, pwd) {
    let url = 'https://mail.163.com'

    await this.pageRobotDefenseAttributeSet(page);

    await page.goto(url)  // 访问登录页面
    const frames = await page.frames();
    const frameLogin = frames.find(f => f.url().indexOf('dl.reg.163.com') > 0);
    // console.log(frameLogin.url())

    await frameLogin.waitForSelector('.j-inputtext.dlemail.j-nameforslide')

    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlemail.j-nameforslide')).value = text; }, username);
    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlpwd')).value = text; }, pwd);

    await frameLogin.waitForSelector('#un-login')
    // set the '十天内免登录'
    await frameLogin.evaluate(() => {
      document.querySelector('#un-login').click()
    })


    await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus.btndisabled').click());


    let yidun = await frameLogin.waitForSelector('.yidun_tips', { timeout: 5 * 1000 }).catch(e => {
      console.log("验证码不存在");
    })

    let totalVerifyCount = 0;
    if (yidun) {
      console.log('发现验证码')

      let rect = await frameLogin.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('.yidun_tips').getBoundingClientRect()
        return { top, left, bottom, right }
      })
      console.log(rect)
      let rectFrame = await page.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('#loginDiv').getBoundingClientRect()
        return { top, left, bottom, right }
      })

      console.log(rectFrame)
      // await this.sleep(2000)
      const mouse = page.mouse
      let needverify = true;
      let faildCount = 0;
      while (needverify && faildCount <= 3) {
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top  +  3)
        await this.sleep(1000)
        let imaRec = await frameLogin.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        if (imaRec.top == 0 && imaRec.left == 0) {
          let loopi = 0;
          while (loopi < 2) {
            await this.sleep(1000)
            imaRec = await frameLogin.evaluate(() => {
              const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
              return { top, left, bottom, right }
            })
            if (imaRec.top != 0 && imaRec.left != 0) {
              break;
            }
            loopi++;
          }
        }
        console.log(imaRec);
        if (imaRec.top == 0 && imaRec.left == 0) {
          console.log(`${username}获取验证码异常`)
          return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateUnKnown }
        }
        await page.screenshot({
          "path": `./yidunpic/imageclip_${username}.png`,
          "clip": {
            x: imaRec.left + rectFrame.left,
            y: imaRec.top + rectFrame.top,
            width: imaRec.right - imaRec.left,
            height: imaRec.bottom - imaRec.top + (rect.bottom - rect.top)
          }
        })
        // Call Chaojiying API to get the there position
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        let res = await this.loginVerifyCodeFetchLoop(`./yidunpic/imageclip_${username}.png`)
        totalVerifyCount++
        if (res != 0 && res != undefined) {
          // save money ?
          // console.log(res)
          // await this.chaoJiYing.reportYidunError(res.pic_id)
          await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
          await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3)
          let posilist = res.pic_str.split('|')
          posilist = posilist.map((item) => item.split(','))
          posilist = posilist.map((item) => item.map((itemA) => +itemA))
          let beginPos = { X: rect.left + rectFrame.left + 3, Y: rect.top + rectFrame.top + 3 }
          if (posilist != undefined && posilist.length == 3) {
            for (let ii = 0; ii < posilist.length; ii++) {
              // await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] -5 , imaRec.top + rectFrame.top +posilist[ii][1] + 5 , { steps: 1 })
              // await mouse.down()
              await this.simMouseMove(mouse, beginPos, { X: imaRec.left + rectFrame.left + posilist[ii][0] - 5, Y: imaRec.top + rectFrame.top + posilist[ii][1] + 5 })

              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 5, imaRec.top + rectFrame.top + posilist[ii][1] + 5, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 3, imaRec.top + rectFrame.top + posilist[ii][1] + 3, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] + 1, { steps: 1 });

              await this.sleep(200)
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top + posilist[ii][1] -2 )
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top + posilist[ii][1], { delay: this.randomInt(100, 60) })
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0] -1, imaRec.top + rectFrame.top +posilist[ii][1] -2 ) 
              // await page.screenshot({"path": `./yidunpic/imageclip_result${ii}.png`})   
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top +posilist[ii][1] ) 
              await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] - 2)

              beginPos = { X: imaRec.left + rectFrame.left + posilist[ii][0] - 1, Y: imaRec.top + rectFrame.top + posilist[ii][1] - 2 }
              if (ii < 2) {
                let waitl = this.randomInt(1000, 400)
                await this.sleep(waitl)
              }
              /// await mouse.up()
              // waitl = this.randomInt(5000, 2000)
              // console.log(waitl)
              // await this.sleep(waitl)
              // console.log(`mouse click ${imaRec.left + rectFrame.left + posilist[ii][0] + 3}, ${imaRec.top + rectFrame.top + posilist[ii][1] + 3}`)
              // await mouse.move(rect.left + rectFrame.left + 2 , rect.top + rectFrame.top + 2, { steps: 1 })
            }
            await this.sleep(1000)
            // check whether the captcha pass

            let response = await frameLogin.evaluate(() => {
              return document.querySelector('.yidun_tips__text.yidun-fallback__tip').innerText
            })
            logger.info('验证结果:' + response)
            // await this.sleep(10000)
            if (response.indexOf('验证成功') != -1) {
              console.log('验证成功')
              needverify = false;
            } else {
              faildCount++;
            }
          }

        } else {
          console.log('failed to get response from chaojiying after tries')
          return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown, "verifyCount": totalVerifyCount}
        }
      }
      if (needverify) {
        console.log(`${username} 验证码尝试${faildCount}次失败`)
        return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateUnKnown, "verifyCount":totalVerifyCount}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus').click());
    }

    await this.sleep(1500)
    let hasPassIndicate = true;
    await frameLogin.waitForSelector('.ferrorhead', { timeout: 3000 }).catch(e => {
      console.log(`${username} 无错误提示`)
      hasPassIndicate = false;
    })

    if (hasPassIndicate) {
      let passText = await frameLogin.evaluate(() => document.querySelector('.ferrorhead').innerText)
      /*
      await page.screenshot({
        "path": `./yidunpic/imagelogin_${username}.png`
      })
      */
      console.log(`${username} 登录提示${passText}`)
      
      if (passText.indexOf('帐号或密码错误') != -1) {
        console.log(`${username} 帐号或密码错误`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFail, "verifyCount":totalVerifyCount}
      }
      // return { "page": page, "cookie": null, "state": WebMailState.WebMailStateAuthFail }
    }

    // await page.waitForNavigation();
    let hasLeftBtn = true;
    await frameLogin.waitForSelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl', { timeout: 5 * 1000 }).catch(e => {
      // handle the password error
      console.log("修改密码不存在");
      hasLeftBtn = false;
    })

    if (hasLeftBtn) {
      let verifyText = await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').innerText)
      // eslint-disable-next-line no-empty
      if (verifyText == "继续登录" || verifyText == "登录") {

      } else {
        console.log(`${username}账号异常需要进一步验证`)
        return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateAuthFurther, "verifyCount":totalVerifyCount}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
    }


    /*
      if (needModifyPass) {
        let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').innerText)
        console.log(verifyText)
        if (verifyText == '前往验证') {
          await frameLogin.evaluate(() => document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').click());
          const target = await context.waitForTarget(t=>t.url().indexOf('m.reg.163.com') != -1)
          const newPage = await target.page();
          await newPage.waitForSelector('.yidun_bg-img').catch(e=> {
            console.log("没有发现验证滑块")
    
          })
          await this.sleep(2000)
    
          let yidunPanelRect = await newPage.evaluate(() => {
            const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
            return { top, left, bottom, right }
          })    
          console.log(yidunPanelRect)
          await newPage.screenshot({
            "path": "./yidunpic/imageclip2.png",
            "clip": {
              x: yidunPanelRect.left,
              y: yidunPanelRect.top,
              width: yidunPanelRect.right - yidunPanelRect.left,
              height: yidunPanelRect.bottom -  yidunPanelRect.top
            }
          })       
    
        }else {
          await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
        }
      }
    */

    let mailCtrlPlane = true
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log("进入邮件主页失败");
      mailCtrlPlane = false;
    })

    if (mailCtrlPlane == false) {
      return {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFurther, "verifyCount":totalVerifyCount}
    }



    let cookies = await page.cookies();

    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType163, cookies)
    return { "page": page, "cookie": cookies, "state": WebMail.WebMailState.WebMailStateAuth , "verifyCount":totalVerifyCount}
  }



  /*
  Try to login 163 and get the cookie
  */
  async mailAccount163CookieFetch(username, pwd) {
    const context = await this.browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    let url = 'https://mail.163.com'

    await this.pageRobotDefenseAttributeSet(page);

    await page.goto(url)  // 访问登录页面
    const frames = await page.frames();
    const frameLogin = frames.find(f => f.url().indexOf('dl.reg.163.com') > 0);
    console.log(frameLogin.url())

    await frameLogin.waitForSelector('.j-inputtext.dlemail.j-nameforslide')

    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlemail.j-nameforslide')).value = text; }, username);
    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlpwd')).value = text; }, pwd);

    await frameLogin.waitForSelector('#un-login')
    // set the '十天内免登录'
    await frameLogin.evaluate(() => {
      document.querySelector('#un-login').click()
    })


    await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus.btndisabled').click());


    let yidun = await frameLogin.waitForSelector('.yidun_tips', { timeout: 5 * 1000 }).catch(e => {
      console.log("验证码不存在");
    })


    if (yidun) {
      console.log('发现验证码')

      let rect = await frameLogin.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('.yidun_tips').getBoundingClientRect()
        return { top, left, bottom, right }
      })
      console.log(rect)
      let rectFrame = await page.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('#loginDiv').getBoundingClientRect()
        return { top, left, bottom, right }
      })

      console.log(rectFrame)
      // await this.sleep(2000)
      const mouse = page.mouse
      let needverify = true;
      let faildCount = 0;
      while (needverify && faildCount <= 3) {
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        // await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top  +  3)
        await this.sleep(1000)
        let imaRec = await frameLogin.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        if (imaRec.top == 0 && imaRec.left == 0) {
          let loopi = 0;
          while (loopi < 2) {
            await this.sleep(1000)
            imaRec = await frameLogin.evaluate(() => {
              const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
              return { top, left, bottom, right }
            })
            if (imaRec.top != 0 && imaRec.left != 0) {
              break;
            }
            loopi++;
          }
        }
        console.log(imaRec);
        if (imaRec.top == 0 && imaRec.left == 0) {
          console.log(`${username}获取验证码异常`)
          return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateUnKnown }
        }
        await page.screenshot({
          "path": `./yidunpic/imageclip_${username}.png`,
          "clip": {
            x: imaRec.left + rectFrame.left,
            y: imaRec.top + rectFrame.top,
            width: imaRec.right - imaRec.left,
            height: imaRec.bottom - imaRec.top + (rect.bottom - rect.top)
          }
        })
        // Call Chaojiying API to get the there position
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        let res = await this.chaoJiYing.getYidunVerifyCode(`./yidunpic/imageclip_${username}.png`)
        if (res != 0) {
          // save money ?
          console.log(res)
          await this.chaoJiYing.reportYidunError(res.pic_id)
          await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
          let posilist = res.pic_str.split('|')
          posilist = posilist.map((item) => item.split(','))
          posilist = posilist.map((item) => item.map((itemA) => +itemA))
          let beginPos = { X: rect.left + rectFrame.left + 3, Y: rect.top + rectFrame.top + 3 }
          if (posilist != undefined && posilist.length == 3) {
            for (let ii = 0; ii < posilist.length; ii++) {
              // await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] -5 , imaRec.top + rectFrame.top +posilist[ii][1] + 5 , { steps: 1 })
              // await mouse.down()
              await this.simMouseMove(mouse, beginPos, { X: imaRec.left + rectFrame.left + posilist[ii][0] - 5, Y: imaRec.top + rectFrame.top + posilist[ii][1] + 5 })

              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 5, imaRec.top + rectFrame.top + posilist[ii][1] + 5, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 3, imaRec.top + rectFrame.top + posilist[ii][1] + 3, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] + 1, { steps: 1 });

              await this.sleep(200)
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top + posilist[ii][1] -2 )
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top + posilist[ii][1], { delay: this.randomInt(100, 60) })
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0] -1, imaRec.top + rectFrame.top +posilist[ii][1] -2 ) 
              // await page.screenshot({"path": `./yidunpic/imageclip_result${ii}.png`})   
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top +posilist[ii][1] ) 
              await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] - 2)

              beginPos = { X: imaRec.left + rectFrame.left + posilist[ii][0] - 1, Y: imaRec.top + rectFrame.top + posilist[ii][1] - 2 }
              if (ii < 2) {
                let waitl = this.randomInt(1000, 400)
                await this.sleep(waitl)
              }
              /// await mouse.up()
              // waitl = this.randomInt(5000, 2000)
              // console.log(waitl)
              // await this.sleep(waitl)
              // console.log(`mouse click ${imaRec.left + rectFrame.left + posilist[ii][0] + 3}, ${imaRec.top + rectFrame.top + posilist[ii][1] + 3}`)
              // await mouse.move(rect.left + rectFrame.left + 2 , rect.top + rectFrame.top + 2, { steps: 1 })
            }
            await this.sleep(1000)
            // check whether the captcha pass

            let response = await frameLogin.evaluate(() => {
              return document.querySelector('.yidun_tips__text.yidun-fallback__tip').innerText
            })
            console.log(response)
            if (response.indexOf('验证成功') != -1) {
              console.log('验证成功')
              needverify = false;
            } else {
              faildCount++;
            }
          }

        } else {
          console.log('failed to get response from chaojiying')
          faildCount++;
        }
      }
      if (needverify) {
        console.log(`${username} 验证码尝试${faildCount}次失败`)
        return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateUnKnown }
      }
      await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus').click());
    }

    await this.sleep(1500)
    let hasPassIndicate = true;
    await frameLogin.waitForSelector('.ferrorhead', { timeout: 3000 }).catch(e => {
      console.log(`${username} 无错误提示`)
      hasPassIndicate = false;
    })

    if (hasPassIndicate) {
      let passText = await frameLogin.evaluate(() => document.querySelector('.ferrorhead').innerText)
      /*
      await page.screenshot({
        "path": `./yidunpic/imagelogin_${username}.png`
      })
      */
      console.log(`${username} 登录提示${passText}`)
      
      if (passText.indexOf('帐号或密码错误') != -1) {
        console.log(`${username} 帐号或密码错误`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFail}
      }
      // return { "page": page, "cookie": null, "state": WebMailState.WebMailStateAuthFail }
    }

    // await page.waitForNavigation();
    let hasLeftBtn = true;
    await frameLogin.waitForSelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl', { timeout: 5 * 1000 }).catch(e => {
      // handle the password error
      console.log("修改密码不存在");
      hasLeftBtn = false;
    })

    if (hasLeftBtn) {
      let verifyText = await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').innerText)
      // eslint-disable-next-line no-empty
      if (verifyText == "继续登录" || verifyText == "登录") {

      } else {
        console.log(`${username}账号异常需要进一步验证`)
        return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateAuthFurther }
      }
      await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
    }


    /*
      if (needModifyPass) {
        let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').innerText)
        console.log(verifyText)
        if (verifyText == '前往验证') {
          await frameLogin.evaluate(() => document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').click());
          const target = await context.waitForTarget(t=>t.url().indexOf('m.reg.163.com') != -1)
          const newPage = await target.page();
          await newPage.waitForSelector('.yidun_bg-img').catch(e=> {
            console.log("没有发现验证滑块")
    
          })
          await this.sleep(2000)
    
          let yidunPanelRect = await newPage.evaluate(() => {
            const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
            return { top, left, bottom, right }
          })    
          console.log(yidunPanelRect)
          await newPage.screenshot({
            "path": "./yidunpic/imageclip2.png",
            "clip": {
              x: yidunPanelRect.left,
              y: yidunPanelRect.top,
              width: yidunPanelRect.right - yidunPanelRect.left,
              height: yidunPanelRect.bottom -  yidunPanelRect.top
            }
          })       
    
        }else {
          await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
        }
      }
    */

    let mailCtrlPlane = true
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log("进入邮件主页失败");
      mailCtrlPlane = false;
    })
    if (mailCtrlPlane == false) {
      return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateAuthFurther }
    }
 
    let cookies = await page.cookies();

    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType163, cookies)
    return { "page": page, "cookie": cookies, "state": WebMail.WebMailState.WebMailStateAuth }
  }



  /*
  Try to login 126 and get the cookie
  */
  async mailAccount126CookieFetch(username, pwd) {
    const context = await this.browser.createIncognitoBrowserContext();
    const page = await context.newPage();   
    // const page = await this.browser.newPage();
    let url = 'https://mail.126.com'
    
    await this.pageRobotDefenseAttributeSet(page);

    await page.goto(url)  // 访问登录页面
    const frames = await page.frames();
    const frameLogin = frames.find(f => f.url().indexOf('passport.126.com') > 0);
    // console.log(frameLogin.url())

    await frameLogin.waitForSelector('.j-inputtext.dlemail.j-nameforslide')

    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlemail.j-nameforslide')).value = text; }, username);
    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlpwd')).value = text; }, pwd);

    await frameLogin.waitForSelector('#un-login')
    // set the '十天内免登录'
    await frameLogin.evaluate(()=> {
      document.querySelector('#un-login').click()
    })

    // await this.sleep(10000)
        
    await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus.btndisabled').click());


    let yidun = await frameLogin.waitForSelector('.yidun_tips', { timeout: 5 * 1000 }).catch(e => {
      console.log("验证码不存在");
    })

    if (yidun) {
      console.log('发现验证码')
      // await this.sleep(10000)
      let rect = await frameLogin.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('.yidun_tips').getBoundingClientRect()
        return { top, left, bottom, right }
      })
      console.log(rect)
      let rectFrame = await page.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('#loginDiv').getBoundingClientRect()
        return { top, left, bottom, right }
      })

      console.log(rectFrame)
      // await this.sleep(2000)
      const mouse = page.mouse
      let needverify = true;
      let faildCount = 0;
      while (needverify && faildCount <=3) {
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        // await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top  +  3)
        await this.sleep(1000)
        let imaRec = await frameLogin.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        if (imaRec.top == 0 && imaRec.left == 0) {
          let loopi = 0;
          while(loopi < 2) {
            await this.sleep(1000)
            imaRec = await frameLogin.evaluate(() => {
              const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
              return { top, left, bottom, right }
            })           
            if (imaRec.top != 0 && imaRec.left != 0) {
              break;
            }
            loopi ++;
          }
        }
        console.log(imaRec);
        if (imaRec.top == 0 && imaRec.left == 0) {
          console.log(`${username}获取验证码异常`)
          return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown}
        }
        await page.screenshot({
          "path": `./yidunpic/imageclip_${username}.png`,
          "clip": {
            x: imaRec.left + rectFrame.left,
            y: imaRec.top + rectFrame.top,
            width: imaRec.right - imaRec.left,
            height: imaRec.bottom - imaRec.top + (rect.bottom - rect.top)
          }
        })
        // await this.sleep(10000)
        // Call Chaojiying API to get the there position
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        let res = await this.chaoJiYing.getYidunVerifyCode(`./yidunpic/imageclip_${username}.png`)
        if (res != 0) {
          // save money ?
          console.log(res)
          await this.chaoJiYing.reportYidunError(res.pic_id)
          
          await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })

          let posilist = res.pic_str.split('|')
          posilist = posilist.map((item) => item.split(','))
          posilist = posilist.map((item) => item.map((itemA) => +itemA))
          let beginPos = {X:rect.left + rectFrame.left + 3, Y: rect.top + rectFrame.top + 3}
          if (posilist != undefined && posilist.length == 3) {
            for (let ii = 0; ii < posilist.length; ii++) {
              // await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] -5 , imaRec.top + rectFrame.top +posilist[ii][1] + 5 , { steps: 1 })
              // await mouse.down()
              await this.simMouseMove(mouse, beginPos, {X: imaRec.left + rectFrame.left + posilist[ii][0] - 5, Y:imaRec.top + rectFrame.top + posilist[ii][1] + 5})

              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 5, imaRec.top + rectFrame.top + posilist[ii][1] + 5, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 3, imaRec.top + rectFrame.top + posilist[ii][1] + 3, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] + 1, { steps: 1 });

              await this.sleep(200)
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top + posilist[ii][1] -2 )
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top + posilist[ii][1], { delay: this.randomInt(100, 60) })
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0] -1, imaRec.top + rectFrame.top +posilist[ii][1] -2 ) 
              // await page.screenshot({"path": `./yidunpic/imageclip_result${ii}.png`})   
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top +posilist[ii][1] ) 
              await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top  + posilist[ii][1] -2)

              beginPos = {X:imaRec.left + rectFrame.left + posilist[ii][0] -1, Y:  imaRec.top + rectFrame.top  + posilist[ii][1] -2}
              if (ii < 2) {
                let waitl = this.randomInt(1000, 400)
                await this.sleep(waitl)
              }
              /// await mouse.up()
              // waitl = this.randomInt(5000, 2000)
              // console.log(waitl)
              // await this.sleep(waitl)
              // console.log(`mouse click ${imaRec.left + rectFrame.left + posilist[ii][0] + 3}, ${imaRec.top + rectFrame.top + posilist[ii][1] + 3}`)
              // await mouse.move(rect.left + rectFrame.left + 2 , rect.top + rectFrame.top + 2, { steps: 1 })
            }
            await this.sleep(1000)
            // check whether the captcha pass
            
            let response = await frameLogin.evaluate(() => {
              return document.querySelector('.yidun_tips__text.yidun-fallback__tip').innerText
            })   
            console.log(response)
            if (response.indexOf('验证成功') != -1) {
              console.log('验证成功')
              needverify = false;
            }else {
              faildCount++;
            }      
          }
    
        } else {
          console.log('failed to get response from chaojiying')
          faildCount++;
        }
      }
      if (needverify) {
        console.log(`${username} 验证码尝试${faildCount}次失败`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus').click());
    }

    let hasPassIndicate = true;
    await frameLogin.waitForSelector('.ferrorhead', {timeout:3000}).catch(e=>{
      console.log(`${username} 无错误提示`)
      hasPassIndicate = false;
    })

    if (hasPassIndicate) {
      let passText = await frameLogin.evaluate(()=>document.querySelector('.ferrorhead').innerText)
      console.log(`${username} 登录提示${passText}`)
      /*
      if (passText.indexOf('帐号或密码错误') != -1) {
        console.log(`${username} 帐号或密码错误`)
        return  {"page":page, "cookie":null, "state":WebMailState.WebMailStateAuthFail}
      }*/
      return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFail} 
    }

    // await page.waitForNavigation();
    let hasLeftBtn = true;
    await frameLogin.waitForSelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl', { timeout: 5 * 1000 }).catch(e => {
      // handle the password error
      console.log("修改密码不存在");
      hasLeftBtn = false;
    })




    if (hasLeftBtn) {
      let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').innerText)
      // eslint-disable-next-line no-empty
      if (verifyText == "继续登录" || verifyText == "登录") {

      }else {
        console.log(`${username}账号异常需要进一步验证`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFurther}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
    }


/*
    if (needModifyPass) {
      let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').innerText)
      console.log(verifyText)
      if (verifyText == '前往验证') {
        await frameLogin.evaluate(() => document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').click());
        const target = await context.waitForTarget(t=>t.url().indexOf('m.reg.163.com') != -1)
        const newPage = await target.page();
        await newPage.waitForSelector('.yidun_bg-img').catch(e=> {
          console.log("没有发现验证滑块")

        })
        await this.sleep(2000)

        let yidunPanelRect = await newPage.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })    
        console.log(yidunPanelRect)
        await newPage.screenshot({
          "path": "./yidunpic/imageclip2.png",
          "clip": {
            x: yidunPanelRect.left,
            y: yidunPanelRect.top,
            width: yidunPanelRect.right - yidunPanelRect.left,
            height: yidunPanelRect.bottom -  yidunPanelRect.top
          }
        })       

      }else {
        await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
      }
    }
*/


    let mailCtrlPlane = true
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log("进入邮件主页失败");
      mailCtrlPlane = false;
    })
    if (mailCtrlPlane == false) {
      return { "page": page, "cookie": null, "state": WebMail.WebMailState.WebMailStateAuthFurther }
    }

    let cookies = await page.cookies();
  
    // let cookie = await page.evaluate(() => document.cookie)
    // console.log(cookies)
    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType126, cookies)
    return {"page":page, "cookie":cookies, "state":WebMail.WebMailState.WebMailStateAuth}

  }


  async mailAccount126CookieFetchUsingPage(page, username, pwd) {
    let url = 'https://mail.126.com'
    
    await this.pageRobotDefenseAttributeSet(page);

    await page.goto(url)  // 访问登录页面
    const frames = await page.frames();
    const frameLogin = frames.find(f => f.url().indexOf('passport.126.com') > 0);
    // console.log(frameLogin.url())

    await frameLogin.waitForSelector('.j-inputtext.dlemail.j-nameforslide')

    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlemail.j-nameforslide')).value = text; }, username);
    await frameLogin.evaluate((text) => { (document.querySelector('.j-inputtext.dlpwd')).value = text; }, pwd);

    await frameLogin.waitForSelector('#un-login')
    // set the '十天内免登录'
    await frameLogin.evaluate(()=> {
      document.querySelector('#un-login').click()
    })

    // await this.sleep(10000)
        
    await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus.btndisabled').click());


    let yidun = await frameLogin.waitForSelector('.yidun_tips', { timeout: 5 * 1000 }).catch(e => {
      console.log("验证码不存在");
    })

    let totalVerifyCount = 0
    if (yidun) {
      console.log('发现验证码')
      // await this.sleep(10000)
      let rect = await frameLogin.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('.yidun_tips').getBoundingClientRect()
        return { top, left, bottom, right }
      })
      console.log(rect)
      let rectFrame = await page.evaluate(() => {
        const { top, left, bottom, right } = document.querySelector('#loginDiv').getBoundingClientRect()
        return { top, left, bottom, right }
      })

      console.log(rectFrame)
      // await this.sleep(2000)
      const mouse = page.mouse
      let needverify = true;
      let faildCount = 0;
      while (needverify && faildCount <=3) {
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top  +  3)
        await this.sleep(1000)
        let imaRec = await frameLogin.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })
        if (imaRec.top == 0 && imaRec.left == 0) {
          let loopi = 0;
          while(loopi < 2) {
            await this.sleep(1000)
            imaRec = await frameLogin.evaluate(() => {
              const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
              return { top, left, bottom, right }
            })           
            if (imaRec.top != 0 && imaRec.left != 0) {
              break;
            }
            loopi ++;
          }
        }
        console.log(imaRec);
        if (imaRec.top == 0 && imaRec.left == 0) {
          console.log(`${username}获取验证码异常`)
          return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown}
        }
        await page.screenshot({
          "path": `./yidunpic/imageclip_${username}.png`,
          "clip": {
            x: imaRec.left + rectFrame.left,
            y: imaRec.top + rectFrame.top,
            width: imaRec.right - imaRec.left,
            height: imaRec.bottom - imaRec.top + (rect.bottom - rect.top)
          }
        })
        // await this.sleep(10000)
        // Call Chaojiying API to get the there position
        await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
        let res = await  this.loginVerifyCodeFetchLoop(`./yidunpic/imageclip_${username}.png`)
        totalVerifyCount++;
        if (res != 0 && res != undefined) {
          // save money ?
          // console.log(res)
          // await this.chaoJiYing.reportYidunError(res.pic_id)
          
          await mouse.move(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3, { steps: 2 })
          await mouse.click(rect.left + rectFrame.left + 3, rect.top + rectFrame.top + 3)

          let posilist = res.pic_str.split('|')
          posilist = posilist.map((item) => item.split(','))
          posilist = posilist.map((item) => item.map((itemA) => +itemA))
          let beginPos = {X:rect.left + rectFrame.left + 3, Y: rect.top + rectFrame.top + 3}
          if (posilist != undefined && posilist.length == 3) {
            for (let ii = 0; ii < posilist.length; ii++) {
              // await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] -5 , imaRec.top + rectFrame.top +posilist[ii][1] + 5 , { steps: 1 })
              // await mouse.down()
              await this.simMouseMove(mouse, beginPos, {X: imaRec.left + rectFrame.left + posilist[ii][0] - 5, Y:imaRec.top + rectFrame.top + posilist[ii][1] + 5})

              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 5, imaRec.top + rectFrame.top + posilist[ii][1] + 5, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 3, imaRec.top + rectFrame.top + posilist[ii][1] + 3, { steps: 1 });
              await mouse.move(imaRec.left + rectFrame.left + posilist[ii][0] - 1, imaRec.top + rectFrame.top + posilist[ii][1] + 1, { steps: 1 });

              await this.sleep(200)
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top + posilist[ii][1] -2 )
              // await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top + posilist[ii][1], { delay: this.randomInt(100, 60) })
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0] -1, imaRec.top + rectFrame.top +posilist[ii][1] -2 ) 
              // await page.screenshot({"path": `./yidunpic/imageclip_result${ii}.png`})   
              // await page.touchscreen.tap(imaRec.left + rectFrame.left + posilist[ii][0], imaRec.top + rectFrame.top +posilist[ii][1] ) 
              await mouse.click(imaRec.left + rectFrame.left + posilist[ii][0] -1 ,  imaRec.top + rectFrame.top  + posilist[ii][1] -2)

              beginPos = {X:imaRec.left + rectFrame.left + posilist[ii][0] -1, Y:  imaRec.top + rectFrame.top  + posilist[ii][1] -2}
              if (ii < 2) {
                let waitl = this.randomInt(1000, 400)
                await this.sleep(waitl)
              }
              /// await mouse.up()
              // waitl = this.randomInt(5000, 2000)
              // console.log(waitl)
              // await this.sleep(waitl)
              // console.log(`mouse click ${imaRec.left + rectFrame.left + posilist[ii][0] + 3}, ${imaRec.top + rectFrame.top + posilist[ii][1] + 3}`)
              // await mouse.move(rect.left + rectFrame.left + 2 , rect.top + rectFrame.top + 2, { steps: 1 })
            }
            await this.sleep(1000)
            // check whether the captcha pass
            
            let response = await frameLogin.evaluate(() => {
              return document.querySelector('.yidun_tips__text.yidun-fallback__tip').innerText
            })   
            logger.info('验证结果:' + response)
            // await this.sleep(10000)
            if (response.indexOf('验证成功') != -1) {
              console.log('验证成功')
              needverify = false;
            }else {
              faildCount++;
            }      
          }
    
        } else {
          console.log('failed to get response from chaojiying')
          return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown, "verifyCount": totalVerifyCount}
        }
      }
      if (needverify) {
        console.log(`${username} 验证码尝试${faildCount}次失败`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateUnKnown, "verifyCount": totalVerifyCount}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-loginbtn.btncolor.tabfocus').click());
    }

    let hasPassIndicate = true;
    await this.sleep(1500)
    await frameLogin.waitForSelector('.ferrorhead', {timeout:3000}).catch(e=>{
      console.log(`${username} 无错误提示`)
      hasPassIndicate = false;
    })

    if (hasPassIndicate) {
      let passText = await frameLogin.evaluate(()=>document.querySelector('.ferrorhead').innerText)
      console.log(`${username} 登录提示${passText}`)
      
      if (passText.indexOf('帐号或密码错误') != -1) {
        console.log(`${username} 帐号或密码错误`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFail, "verifyCount": totalVerifyCount}
      }
      // return  {"page":page, "cookie":null, "state":WebMailState.WebMailStateAuthFail} 
    }

    // await page.waitForNavigation();
    let hasLeftBtn = true;
    await frameLogin.waitForSelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl', { timeout: 5 * 1000 }).catch(e => {
      // handle the password error
      console.log("修改密码不存在");
      hasLeftBtn = false;
    })




    if (hasLeftBtn) {
      let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').innerText)
      // eslint-disable-next-line no-empty
      if (verifyText == "继续登录" || verifyText =="登录") {

      }else {
        console.log(`${username}账号异常需要进一步验证`)
        return  {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFurther, "verifyCount": totalVerifyCount}
      }
      await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
    }


/*
    if (needModifyPass) {
      let verifyText = await frameLogin.evaluate(()=> document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').innerText)
      console.log(verifyText)
      if (verifyText == '前往验证') {
        await frameLogin.evaluate(() => document.querySelector('.u-btn-middle3.btncolor.j-redirect.f-fr').click());
        const target = await context.waitForTarget(t=>t.url().indexOf('m.reg.163.com') != -1)
        const newPage = await target.page();
        await newPage.waitForSelector('.yidun_bg-img').catch(e=> {
          console.log("没有发现验证滑块")

        })
        await this.sleep(2000)

        let yidunPanelRect = await newPage.evaluate(() => {
          const { top, left, bottom, right } = document.querySelector('.yidun_bg-img').getBoundingClientRect()
          return { top, left, bottom, right }
        })    
        console.log(yidunPanelRect)
        await newPage.screenshot({
          "path": "./yidunpic/imageclip2.png",
          "clip": {
            x: yidunPanelRect.left,
            y: yidunPanelRect.top,
            width: yidunPanelRect.right - yidunPanelRect.left,
            height: yidunPanelRect.bottom -  yidunPanelRect.top
          }
        })       

      }else {
        await frameLogin.evaluate(() => document.querySelector('.u-btn.u-btn-middle3.f-ib.bgcolor.f-fl').click());
      }
    }
*/

    let mailCtrlPlane = true
    await page.waitForSelector('.js-component-component.ra0.mD0').catch(e => {
      console.log("进入邮件主页失败");
      mailCtrlPlane = false;
    })
    if (mailCtrlPlane == false) {
      return {"page":page, "cookie":null, "state":WebMail.WebMailState.WebMailStateAuthFurther, "verifyCount": totalVerifyCount}
    }


    let cookies = await page.cookies();
  
    // let cookie = await page.evaluate(() => document.cookie)
    // console.log(cookies)
    await this.cookieMana.appendCookieData(username, WebMailType.WebMailType126, cookies)
    return {"page":page, "cookie":cookies, "state":WebMail.WebMailState.WebMailStateAuth, "verifyCount": totalVerifyCount}

  }

  async mainSendMailFrom163(username, pwd, mailToList, mailHeader,  mailSubject) {
    let page = await this.login163WithCookie(username, pwd)
    if (page == undefined) {
      return {state:'error', rescode:'logfail'}
    }
    await this.mainSendMailFrom163UsingPage(page, username, mailToList, mailHeader, mailSubject);

  }


  /**
   *  random  范围  (minNumber,maxNumber];   minNumber 默认0
   * @param i
   * @returns {number}
   */
  randomInt(maxNumber, minNumber) {
    if (!minNumber) {
      minNumber = 0;
    }
    return Math.round(Math.random() * maxNumber) + 1 + minNumber;
  }

  async updateMailAccountDbInfo(username, webType, pwd, mailState) {
    await this.cookieMana.appendUserAccount(username, webType, pwd, mailState)
  }

  async mailExpireCookieClean() {

    let allCookie = await this.cookieMana.getAllCookie()
    logger.info(`all cookie length ${allCookie.length}`)
    for (let ii = 0; ii < allCookie.length; ii++) {
        let cookie = allCookie[ii]
        let nowtime = Date.now();
        if (nowtime - cookie.time >= this.cookieExpireTime * 1000 ) {
          logger.info(`cookie ${cookie.name} 超时, 删除`)
          await this.cookieMana.delCookie(cookie.name, cookie.webType)
          
        }
    }
  }
  getRandomNum(min, max) {
    let range = max - min;
    let rand = Math.random();
    return (min + Math.round(rand * range));
  }    
}




if(__filename === process.mainModule.filename) {
  
  var args = process.argv
  let mailAddr = ''
  let webType = ''
  if (args.length > 2 && args[2].indexOf('@') != -1) {
    mailAddr = args[2]
    let spList = mailAddr.split('@');
    if (spList.length != 2) {
      logger.error(`${mailAddr} 不是合法的邮箱地址`)
      return
    }

    if (spList[1] != '163.com' && spList[1] != '126.com') {
      logger.error(`${mailAddr} 不支持的邮箱类型`)
      return
    }

    if (spList[1] == '163.com') {
      webType = '163'
    }else {
      webType = '126'
    }
    const login126 = new WebMail();
    const mailCfg = require('./mailcfg.json')
    if (webType == '163') {
      (async function testMailCookie() { 
 

        await login126.init(true, `mongodb://${mailCfg.mongoCfg.ip}:${mailCfg.mongoCfg.ip}/`);
  
  
        // let sendResult = await login126.checkMailFrom163SendResult(page, ['dc354821689@qq.com', "1140712280"])
        // logger.info(sendResult)
        
  
      })()
    } else {
      (async function testMail126Cookie() { 
  
         await login126.init(true, `mongodb://${mailCfg.mongoCfg.ip}:${mailCfg.mongoCfg.ip}/`);
  
 
    
        // let sendResult = await login126.checkMailFrom126SendResult(page, ['dc354821689@qq.com', "1140712280"])
        // logger.info(sendResult)
        
      })()
  
    }    
  }else if (args.length > 2 && args[2].indexOf('delTimeout') !=-1) {
    (async ()=>{
    const login126 = new WebMail();
    const mailCfg = require('./mailcfg.json')

    await login126.init(true, `mongodb://${mailCfg.mongoCfg.ip}:${mailCfg.mongoCfg.ip}/`);
    await login126.mailExpireCookieClean();

      // let sendResult = await login126.checkMailFrom163SendResult(page, ['dc354821689@qq.com', "1140712280"])
      // logger.info(sendResult)
      

    })()
  }
  else if (args.length > 3 && args[2].indexOf('sendMail') != -1) {
    (async ()=>{
      const login126 = new WebMail();
      const mailCfg = require('./mailcfg.json')
      let spList = args[3].split('@');
      let webType
      if (spList.length != 2) {
        logger.error(`${args[3]} 不是合法的邮箱地址`)
        return
      }
  
      if (spList[1] != '163.com' && spList[1] != '126.com') {
        logger.error(`${mailAddr} 不支持的邮箱类型`)
        return
      }
  
      if (spList[1] == '163.com') {
        webType = '163'
      }else {
        webType = '126'
      }  
      await login126.init(true, `mongodb://${mailCfg.mongoCfg.ip}:${mailCfg.mongoCfg.ip}/`);
      if (webType == '126') {
        await login126.mainSendMailFrom126(args[3], 'wxc9017236@126.com', 'idui125855@sina.com', 'aaa', 'bbb')
      }else {
        await login126.mainSendMailFrom163(args[3], 'wxc9017236@126.com', 'idui125855@sina.com', 'aaa', 'bbb')

      }
      
        // let sendResult = await login126.checkMailFrom163SendResult(page, ['dc354821689@qq.com', "1140712280"])
        // logger.info(sendResult)
        
  
      })()
  }else {
    logger.error('请输入邮箱地址')
    return

  }

 


}

module.exports = WebMail
