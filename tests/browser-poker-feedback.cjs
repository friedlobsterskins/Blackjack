'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const E = require('../game-engine.js');
const { launchBrowser, ROOT } = require('./browser-smoke.cjs');

async function run() {
  const session = await launchBrowser();
  const { cdp, errors } = session;
  const url = pathToFileURL(path.join(ROOT,'index.html')).href;
  async function fixture(sequence, reduced = false) {
    const deck = sequence.split(' ').map(c => ({rank:c.slice(0,-1),suit:c.slice(-1)})).reverse();
    const round = E.createUltimate(25,5,deck);
    const saved = {version:1,savedAt:Date.now(),balance:9945,game:'ultimate',bets:{blackjack:25,ultimate:25,trips:5},net:0,hands:0,history:[],shoe:[],round,sound:false};
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced ? 'reduce' : 'no-preference'}]});
    await cdp.evaluate(`localStorage.setItem('clubRoyaleCasino.v1',${JSON.stringify(JSON.stringify(saved))})`);
    await cdp.send('Page.navigate',{url});
    await cdp.waitFor(`!!document.querySelector('[data-action="play4"]')`,'fixture ready');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.house-card').length`),0,'No qualifying cards disclosed before showdown');
    await cdp.click('[data-action="play4"]');
  }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1365,height:768,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url});
    await cdp.waitFor(`document.readyState === 'complete' && !!window.CasinoEngine`);
    await fixture('AS QD AH QC 2S 3H 7D 8C 9S');
    await cdp.waitFor(`!!document.querySelector('.payout-win')`,'winning payout');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#dealer-hand .house-card').length`),2);
    const during = await cdp.evaluate(`(() => ({kinds:[...document.querySelectorAll('.payout-stack')].map(e=>e.className),locked:document.querySelector('#deal-btn').disabled,balance:document.querySelector('#balance').textContent,round:JSON.parse(localStorage.getItem('clubRoyaleCasino.v1')).round}))()`);
    assert.ok(during.kinds.some(c=>c.includes('payout-loss')),'Losing Trips travels to house');
    assert.ok(during.kinds.some(c=>c.includes('payout-return')),'Pushed Blind returns to player');
    assert.equal(during.locked,true);
    assert.equal(during.balance,'$9,845.00','Wallet waits for chip collection');
    await cdp.screenshot('ultimate-chip-payout.png');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`,'payout complete');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.payout-layer').length`),0);
    assert.equal(await cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1')).hands`),1);
    assert.equal(await cdp.evaluate(`document.querySelector('#balance').textContent`),'$10,120.00');
    assert.equal(await cdp.evaluate(`[...document.querySelectorAll('.poker-spot .coin-group')].every(e=>getComputedStyle(e).visibility==='hidden')`),true);
    await cdp.screenshot('ultimate-house-qualifies.png');
    console.log('PASS Mixed win/push/loss chip flights, locked controls, delayed wallet, cleanup and house pair.');

    await fixture('QD AS QC AH 2S 3H 7D 8C 9S');
    await cdp.waitFor(`!!document.querySelector('.payout-loss')`,'losing payout');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.payout-win,.payout-return').length`),0);
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
    console.log('PASS All losing wagers leave toward the house.');

    for (const [sequence,house,board] of [
      ['AS KS JD QD 2S 2H 4D 7C 9S',0,2],
      ['AS 2D KS 3C QS JS 10S 7H 6C',0,0],
      ['2H AS 3D KD QS JS 10S 7H 6C',2,3]
    ]) {
      await fixture(sequence,true);
      await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
      assert.equal(await cdp.evaluate(`document.querySelectorAll('#dealer-hand .house-card').length`),house);
      assert.equal(await cdp.evaluate(`document.querySelectorAll('#community-hand .house-card').length`),board);
      assert.equal(await cdp.evaluate(`document.querySelectorAll('.payout-layer').length`),0);
    }
    console.log('PASS Board-only qualification, unqualified house, five-card straight and reduced motion.');
    for (const [width,height] of [[1365,768],[1920,1080],[768,1024],[390,844],[360,640],[844,390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      const layout = await cdp.evaluate(`(() => {
        const caption=document.querySelector('#dealer-caption');
        const a=caption.getBoundingClientRect(),b=document.querySelector('.community-zone').getBoundingClientRect(),r=document.querySelector('#table-result').getBoundingClientRect();
        return {overlap:getComputedStyle(caption).display!=='none' && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top,
          resultOverlap:getComputedStyle(caption).display!=='none' && a.left<r.right && a.right>r.left && a.top<r.bottom && a.bottom>r.top,
          cards:[...document.querySelectorAll('.house-card')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,right:r.right,bottom:r.bottom+scrollY};}),
          fits:document.documentElement.scrollWidth<=innerWidth};
      })()`);
      assert.equal(layout.overlap,false,`${width}x${height}: dealer caption clears community cards`);
      assert.equal(layout.resultOverlap,false,`${width}x${height}: dealer caption clears result`);
      assert.equal(layout.fits,true,`${width}x${height}: no horizontal scrolling`);
      const pageHeight=await cdp.evaluate('document.documentElement.scrollHeight');
      for (const card of layout.cards) assert.ok(card.x>=0 && card.y>=0 && card.right<=width && card.bottom<=pageHeight,'Raised cards fit');
      if (width===360 || width===1365) await cdp.screenshot(`ultimate-feedback-${width}x${height}.png`);
    }
    const balance = await cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1')).balance`);
    await cdp.send('Page.navigate',{url});
    await cdp.waitFor(`document.readyState==='complete' && !!document.querySelector('.house-card')`);
    assert.equal(await cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1')).balance`),balance);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.payout-layer').length`),0,'Reload does not replay payouts');
    console.log('PASS Showdown layout at six sizes and settled reload without duplicate payout.');
    assert.deepEqual(errors,[]);
  } finally { await session.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
