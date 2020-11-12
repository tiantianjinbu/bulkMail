const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')

class BackendServer  {
  constructor(port) {
    this.name = '服务'
    this.port = port
    this.funcGetSuccessInfo = null;
    this.funcGetSenderStat = null;
    this.funcGetLeftSend = null;
  }

  setGetSuccessFun(func){
      this.funcGetSuccessInfo = func;
  }
  setGetSenderStatFun(func) {
      this.funcGetSenderStat = func;
  }

  setGetLeftSendFun(func) {
    this.funcGetLeftSend = func;
  }
  async run() {
    const app = new Koa()
    app.use(bodyParser())
    let router = new Router()
    router.get('/', async (ctx, next) => {
      // ctx.body = '<h1>^_^</h1>'
      ctx.response.body = await this.funcGetSuccessInfo();

    })
    router.get('/sender', async (ctx, next) => {
        // ctx.body = '<h1>^_^</h1>'
        ctx.response.body = await this.funcGetSenderStat();

      })

    router.get('/left', async(ctx, next)=> {
      if (this.funcGetLeftSend) {
        ctx.response.body =  await this.funcGetLeftSend();
      }else {
        ctx.response.body = '<br> not defined </br>'

      }
      

    })
    router.post('/login', async (ctx, next) => {
      ctx.set('Content-Type', 'application/json')
      try {
        let data = ctx.request.body
        // let result = await this.login.run(data) || {}
        let result = {result:'OK'}
        // ctx.set('set-cookie', _.get(result, 'cookies', []).map(cookie => typeof (cookie) === 'string' ? cookie : `${cookie.name}=${cookie.value}`).join('; '))
        ctx.response.body = result;
      } catch(e) {
        console.log('error handle post')
      }
    })
    app.use(router.routes())
    app.listen(this.port, () => {
      console.log(`服务已运行：http://127.0.0.1:${this.port}`)
    })
  }
}


module.exports =  BackendServer