'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const E = require('../game-engine.js');
const {launchBrowser,ROOT} = require('./browser-smoke.cjs');

async function run() {
  const session = await launchBrowser();
  const {cdp,errors} = session;
  const url = pathToFileURL(path.join(ROOT,'index.html')).href;
  const saved = () => cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1'))`);
  const ready = () => cdp.waitFor(`document.readyState==='complete' && !!document.querySelector('[data-zone]')`);
  async function fixture(sequence,phase='preflop',reduced=false) {
    const deck = sequence.split(' ').map(c=>({rank:c.slice(0,-1),suit:c.slice(-1)})).reverse();
    const round = E.createUltimate(25,5,deck);
    round.phase = phase;
    const state = {version:1,savedAt:Date.now(),balance:9945,startingAmount:10000,game:'ultimate',bets:{blackjack:25,ultimate:25,trips:5},net:0,hands:0,history:[],shoe:[],round,sound:false};
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
    await cdp.evaluate(`localStorage.setItem('clubRoyaleCasino.v1',${JSON.stringify(JSON.stringify(state))})`);
    await cdp.send('Page.navigate',{url}); await ready();
  }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url}); await ready();
    await cdp.screenshot('updated-blackjack-desktop.png');
    assert.equal(await cdp.evaluate(`!!document.querySelector('footer,[data-adjust="twice"]')`),false);
    await cdp.evaluate(`(() => {
      const original=CasinoEngine.createBlackjack;
      CasinoEngine.createBlackjack=bet=>{CasinoEngine.createBlackjack=original;return original(bet,'8S 10H 9D 7C'.split(' ').map(c=>({rank:c.slice(0,-1),suit:c.slice(-1)})).reverse());};
      window.dealFrames=[];
      window.dealObserver=new MutationObserver(()=>window.dealFrames.push([document.querySelectorAll('#player-hands .card:not(.card-placeholder)').length,document.querySelectorAll('#dealer-hand .card:not(.card-placeholder)').length,document.querySelectorAll('#dealer-hand .card-back').length]));
      window.dealObserver.observe(document.querySelector('#table'),{childList:true,subtree:true});
    })()`);
    await cdp.click('#deal-btn');
    await cdp.waitFor(`!!document.querySelector('[data-action="stand"]:not(:disabled)')`);
    const frames=await cdp.evaluate(`window.dealObserver.disconnect();window.dealFrames`);
    for(const frame of [[1,0,0],[1,1,0],[2,1,0],[2,2,1]]) assert.ok(frames.some(f=>JSON.stringify(f)===JSON.stringify(frame)),`Opening deal includes ${frame}`);
    assert.equal(await cdp.evaluate(`document.querySelector('#dealer-total').textContent`),'10');
    await cdp.click('[data-action="stand"]');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
    assert.equal((await saved()).balance,10000);
    console.log('PASS Blackjack alternates player/dealer one card at a time, conceals the hole card, then returns a push once.');
    await cdp.click('#tab-ultimate');
    for(let i=0;i<5;i++) await cdp.click('[data-zone="ante"]');
    await cdp.waitFor(`!document.querySelector('.flying-chip')`);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-zone="ante"] .coin-group').dataset.chipCount`),'6');
    await cdp.screenshot('updated-ultimate-desktop.png');
    for(const [width,height] of [[1920,1080],[1365,768],[768,1024],[390,844],[360,640],[844,390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      const layout = await cdp.evaluate(`(() => {
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        return {overflow:document.documentElement.scrollWidth>innerWidth,table:rect(document.querySelector('#table')),zones:Object.fromEntries([...document.querySelectorAll('[data-zone]')].map(e=>[e.dataset.zone,rect(e)])),paytable:rect(document.querySelector('#table-paytable')),community:rect(document.querySelector('.community-zone')),cards:[...document.querySelectorAll('#community-hand .card')].map(rect)};
      })()`);
      assert.equal(layout.overflow,false,`No horizontal scroll at ${width}`);
      assert.ok(layout.table.height>=600,'Felt keeps enough vertical room');
      assert.ok(layout.paytable.width>0,'Ratios stay visible on the felt');
      assert.ok(layout.zones.trips.bottom < layout.zones.play.y);
      assert.ok(layout.zones.play.bottom < layout.zones.ante.y);
      assert.ok(Math.abs(layout.zones.play.x-layout.zones.ante.x)<1);
      assert.ok(layout.cards.every(c=>c.x>=layout.table.x && c.right<=layout.table.right));
      const a=layout.paytable,b=layout.community;
      assert.ok(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y,`Payout text clears community cards at ${width}`);
      await cdp.screenshot(`updated-ultimate-${width}x${height}.png`);
    }
    console.log('PASS Physical chip stacks, visible limits/payouts, vertically aligned betting circles at six sizes.');

    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});
    await fixture('KS QD JH QC 2S 2H 9D 9C AS','preflop',true);
    assert.equal(await cdp.evaluate(`!!document.querySelector('[data-action="play3"]')`),false);
    await cdp.click('[data-chip="25"]');
    for(let i=0;i<3;i++) await cdp.click('[data-zone="play"]');
    assert.equal((await saved()).balance,9945);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-action="confirm-play"]').disabled`),false);
    await cdp.click('[data-action="undo"]');
    assert.equal(await cdp.evaluate(`document.querySelector('[data-action="confirm-play"]').disabled`),true);
    await cdp.click('[data-zone="play"]');
    await cdp.send('Page.navigate',{url}); await ready();
    assert.deepEqual((await saved()).round.draftChips,[25,25,25]);
    await cdp.click('[data-action="confirm-play"]');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
    assert.equal((await saved()).round.play,75);
    console.log('PASS Manual 3× Play, undo, multiplier validation, refresh recovery and single settlement.');

    await fixture('KS QD JH QC 2S 2H 9D 9C AS');
    await cdp.click('[data-action="check"]');
    await cdp.waitFor(`document.querySelectorAll('#community-hand .house-card').length===2`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#dealer-hand .card-back').length`),2);
    await cdp.waitFor(`!!document.querySelector('[data-action="play2"]')`);
    await cdp.click('[data-action="check"]');
    await cdp.waitFor(`!!document.querySelector('[data-action="play1"]')`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#community-hand .house-card').length`),4);
    await cdp.click('[data-action="play1"]');
    await cdp.waitFor(`document.querySelectorAll('#dealer-hand .card-back').length===1`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#community-hand .house-card').length`),4);
    await cdp.waitFor(`document.querySelectorAll('#dealer-hand .house-card').length===2`);
    const raised = await cdp.evaluate(`[...document.querySelectorAll('#community-hand .house-card')].map(e=>e.getAttribute('aria-label'))`);
    assert.equal(raised.length,2); assert.ok(raised.every(text=>text.startsWith('9 of')));
    await cdp.screenshot('updated-live-house-hand.png');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
    console.log('PASS House cards rise on the flop, update at the river and lower when replaced by the dealer pocket pair.');

    await fixture('AS QD AH QC 2S 3H 7D 8C 9S');
    await cdp.click('[data-action="play4"]');
    await cdp.waitFor(`!!document.querySelector('[data-paid-amount]')`);
    assert.equal(await cdp.evaluate(`document.querySelector('#deal-btn').disabled`),true);
    assert.ok(await cdp.evaluate(`[...document.querySelectorAll('[data-paid-amount]')].some(e=>Number(e.querySelector('.coin-group').dataset.chipCount)>=2)`));
    await cdp.screenshot('updated-growing-payout.png');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`);
    assert.equal((await saved()).balance,10120);
    assert.equal(await cdp.evaluate(`document.querySelector('#balance').textContent`),'$10,120.00');
    console.log('PASS Winnings grow the wager stack before collection and the wallet reconciles exactly.');

    await cdp.click('#bankroll-btn');
    await cdp.click('[data-amount="1000"]');
    await cdp.click('[data-action="reset-bankroll"]');
    assert.equal((await saved()).balance,1000);
    await cdp.evaluate(`const s=JSON.parse(localStorage.getItem('clubRoyaleCasino.v1'));s.savedAt=Date.now()-1800001;s.balance=17;localStorage.setItem('clubRoyaleCasino.v1',JSON.stringify(s));`);
    await cdp.send('Page.navigate',{url}); await ready();
    assert.equal((await saved()).balance,1000); assert.equal((await saved()).game,'blackjack');
    console.log('PASS Bankroll presets, reset, and 30-minute refresh expiry.');
    assert.deepEqual(errors,[]);
  } finally { await session.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
