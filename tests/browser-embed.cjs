/* Verify the game in a real same-origin iframe: node tests/browser-embed.cjs */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { launchBrowser, ROOT } = require('./browser-smoke.cjs');

async function run() {
  const allowed = new Map([
    ['/embed.html','text/html'],['/index.html','text/html'],['/styles.css','text/css'],['/table-layout.css','text/css'],
    ['/script.js','text/javascript'],['/game-engine.js','text/javascript']
  ]);
  const server = http.createServer(async (request,response) => {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    if(!allowed.has(pathname)) {response.writeHead(404);response.end();return;}
    try {
      const body = await fs.readFile(path.join(ROOT,pathname.slice(1)));
      response.writeHead(200,{'Content-Type':allowed.get(pathname)+'; charset=utf-8'});
      response.end(body);
    } catch {response.writeHead(500);response.end();}
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  let session;
  try {
    session = await launchBrowser();
    const {cdp,errors} = session;
    const frame = expression => cdp.evaluate(`document.querySelector('iframe').contentWindow.eval(${JSON.stringify(expression)})`);
    const frameWait = expression => cdp.waitFor(`document.querySelector('iframe')?.contentDocument?.readyState==='complete' && document.querySelector('iframe').contentWindow.eval(${JSON.stringify(expression)})`,'embedded '+expression);
    async function frameClick(selector) {
      const location = await cdp.evaluate(`(() => {
        const iframe=document.querySelector('iframe'),doc=iframe.contentDocument,element=doc.querySelector(${JSON.stringify(selector)});
        if(!element||element.disabled)throw new Error('Unavailable embedded control: '+${JSON.stringify(selector)});
        element.scrollIntoView({block:'center',inline:'center'});
        const r=element.getBoundingClientRect(),f=iframe.getBoundingClientRect();
        if(!r.width||!r.height)throw new Error('Hidden embedded control');
        const hit=doc.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        if(hit!==element&&!element.contains(hit))throw new Error('Covered embedded control: '+${JSON.stringify(selector)});
        return {x:f.x+r.x+r.width/2,y:f.y+r.y+r.height/2};
      })()`);
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...location,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...location,button:'left',clickCount:1});
    }
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1365,height:768,deviceScaleFactor:1,mobile:false});
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/embed.html'});
    await frameWait(`!!window.CasinoEngine&&!!document.querySelector('#deal-btn')`);
    await cdp.click('#embed-code-button');
    assert.equal(await cdp.evaluate(`document.querySelector('#embed-code').open`),true);
    assert.match(await cdp.evaluate(`document.querySelector('#embed-code code').textContent`),/allow="fullscreen"/);
    await cdp.click('.close-button');
    await frameClick('#tab-ultimate');
    await frameClick('#deal-btn');
    await frameWait(`!!document.querySelector('[data-action="check"]:not(:disabled)')`);
    await frameClick('[data-action="check"]');
    await frameWait(`!!document.querySelector('[data-action="check"]:not(:disabled)')`);
    await frameClick('[data-action="check"]');
    await frameWait(`!!document.querySelector('[data-action="play1"]:not(:disabled)')`);

    for(const [width,height] of [[1365,768],[390,844],[844,390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      assert.equal(await cdp.evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`),true,'Embedded page fits '+width+'x'+height);
      assert.equal(await frame(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`),true,'Game fits without scrolling inside its iframe at '+width+'x'+height);
      const visible = await frame(`Array.from(document.querySelectorAll('#dealer-hand .card,#community-hand .card,#player-hands .card,#game-actions button')).every(el=>{
        const r=el.getBoundingClientRect();return r.x>=-1&&r.y+scrollY>=-1&&r.right<=innerWidth+1&&r.bottom+scrollY<=document.documentElement.scrollHeight+1;
      })`);
      assert.equal(visible,true,'Cards and decisions fit inside the iframe at '+width+'x'+height);
      await cdp.screenshot('redesign-embed-'+width+'x'+height+'.png');
    }
    await frameClick('[data-action="play1"]');
    await frameWait(`!document.querySelector('#deal-btn').disabled`);
    assert.equal(await frame(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1')).hands`),1,'A real embedded hand settles');

    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1365,height:768,deviceScaleFactor:1,mobile:false});
    await frameClick('#fullscreen-btn');
    await cdp.waitFor(`document.fullscreenElement===document.querySelector('iframe')`,'iframe fullscreen entry');
    assert.equal(await frame(`!!document.fullscreenElement`),true,'Fullscreen is active inside the game');
    await frameClick('[data-open="rules"]');
    assert.equal(await frame(`document.querySelector('#info-dialog').open`),true,'Rules remain accessible inside fullscreen iframe');
    await frameClick('#dialog-close');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.waitFor(`!document.fullscreenElement`,'iframe fullscreen exit');
    assert.equal(await frame(`document.querySelector('#fullscreen-btn').getAttribute('aria-pressed')`),'false');
    await frameClick('#tab-blackjack');
    assert.equal(await frame(`document.querySelector('#table').classList.contains('blackjack-table')`),true);
    assert.deepEqual(errors,[],'No errors while embedded');
    console.log('PASS Real iframe gameplay, three viewport sizes, embed code, fullscreen permission, rules in fullscreen, Escape and table switching.');
  } catch(error) {
    try {if(session)await session.cdp.screenshot('redesign-embed-failure.png');} catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    if(session)await session.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
