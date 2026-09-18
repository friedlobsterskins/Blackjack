'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser, ROOT } = require('./browser-smoke.cjs');

async function run() {
  const session = await launchBrowser();
  const {cdp,errors} = session;
  const saved = () => cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1'))`);
  const settled = () => cdp.waitFor(`!document.querySelector('#deal-btn').disabled`, 'settlement');
  const decision = () => cdp.waitFor(`!!document.querySelector('#game-actions button:not(:disabled)')`, 'decision');
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width:1365,height:768,deviceScaleFactor:1,mobile:false});
    await cdp.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await cdp.send('Page.navigate', {url:pathToFileURL(path.join(ROOT,'index.html')).href});
    await cdp.waitFor(`document.readyState === 'complete' && !!window.CasinoEngine`, 'load');
    await cdp.click('#fullscreen-btn');
    await cdp.waitFor(`!!document.fullscreenElement && document.querySelector('#fullscreen-btn').getAttribute('aria-pressed') === 'true'`, 'native fullscreen entry');
    assert.equal(await cdp.evaluate(`document.querySelector('#fullscreen-btn').getAttribute('aria-pressed')`),'true');
    await cdp.click('[data-open="rules"]');
    assert.equal(await cdp.evaluate(`document.querySelector('#info-dialog').open`),true,'Rules available in fullscreen');
    await cdp.click('#dialog-close');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.waitFor(`!document.fullscreenElement && document.querySelector('#fullscreen-btn').getAttribute('aria-pressed') === 'false'`, 'fullscreen exit');
    console.log('PASS Native fullscreen, modal access, fullscreenchange and exit.');
    await cdp.click('#tab-ultimate');
    await cdp.click('[data-action="clear"]');
    await cdp.click('[data-chip="25"]');
    await cdp.click('[data-zone="ante"]');
    await cdp.click('[data-chip="5"]');
    await cdp.click('[data-zone="trips"]');
    let state = await saved();
    assert.equal(state.bets.ultimate,25);
    assert.equal(state.bets.trips,5);
    assert.equal(state.balance,10000);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-zone="ante"] .zone-value').textContent`),'$25');
    assert.equal(await cdp.evaluate(`document.querySelector('[data-zone="blind"] .zone-value').textContent`),'$25');
    await cdp.click('[data-action="undo"]');
    assert.equal((await saved()).bets.trips,0);
    await cdp.click('[data-zone="trips"]');
    await cdp.screenshot('immersive-ultimate-betting.png');
    console.log('PASS Table betting, chip stacks, matching Ante/Blind, Trips, clear and undo.');
    await cdp.click('#deal-btn'); await decision();
    await cdp.click('[data-action="check"]'); await decision();
    await cdp.click('[data-action="check"]'); await decision();
    const closeup = await cdp.evaluate(`(() => {
      const player=document.querySelector('#player-hands .card');
      const dealer=document.querySelector('#dealer-hand .card');
      return {playerHeight:player.offsetHeight,dealerHeight:dealer.offsetHeight,transform:getComputedStyle(player).transform};
    })()`);
    assert.ok(closeup.playerHeight >= closeup.dealerHeight,'Player hole cards remain at least as readable as dealer cards');
    assert.notEqual(closeup.transform,'none','Player cards form a diagonal fan');
    assert.equal(await cdp.evaluate(`document.querySelector('#bet-input').max`),'2000');
    for(const [width,height] of [[1365,768],[1920,1080],[768,1024],[390,844],[360,640],[844,390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      await cdp.evaluate('window.scrollTo(0,0)');
      const pageHeight = await cdp.evaluate('document.documentElement.scrollHeight');
      assert.ok(pageHeight<=height,`No vertical scrolling at ${width}x${height}`);
      const boxes = await cdp.evaluate(`(() => {
        const selectors = ['.topbar','.control-deck','#game-actions','#wager-total','.chip-selector','.dealer-zone','#community-hand','.player-zone','[data-zone="trips"]','[data-zone="ante"]','[data-zone="blind"]','[data-zone="play"]'];
        return selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
      })()`);
      for(const box of boxes) {
        assert.ok(box.x>=-1 && box.y>=-1 && box.right<=width+1 && box.bottom<=pageHeight+1, `${width}x${height}: ${box.selector} must fit: ${JSON.stringify(box)}`);
      }
      assert.equal(await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,`No horizontal scrolling at ${width}x${height}`);
      await cdp.screenshot('immersive-ultimate-'+width+'x'+height+'.png');
    }
    await cdp.click('[data-chip="25"]');
    await cdp.click('[data-zone="play"]');
    await cdp.click('[data-action="confirm-play"]');
    await settled();
    state = await saved();
    assert.equal(state.round.play,25);
    assert.equal(state.round.wagered,80);
    assert.equal(state.balance,10000-80+state.round.returned);
    await cdp.click('[data-action="clear"]');
    await cdp.click('[data-action="repeat"]');
    assert.equal((await saved()).bets.ultimate,25);
    assert.equal((await saved()).bets.trips,5);
    await cdp.click('#tab-blackjack');
    for(const [width,height] of [[1365,768],[390,844],[844,390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      assert.equal(await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth`),true);
      await cdp.screenshot('immersive-blackjack-'+width+'x'+height+'.png');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS Six viewport sizes without scrolling, manual Play-circle confirmation and Rebet.');
  } finally { await session.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
