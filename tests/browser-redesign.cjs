/* Real-browser presentation regressions. Run: node tests/browser-redesign.cjs */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser, ROOT } = require('./browser-smoke.cjs');

const VIEWPORTS = [[1365,768],[1920,1080],[768,1024],[390,844],[360,640],[844,390]];

async function run() {
  const session = await launchBrowser();
  const { cdp, errors } = session;
  const saved = () => cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1'))`);
  const decision = () => cdp.waitFor(`!!document.querySelector('#game-actions button:not(:disabled)')`, 'player decision');
  const settled = () => cdp.waitFor(`!document.querySelector('#deal-btn').disabled`, 'completed hand');
  const viewport = (width,height) => cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
  const press = async (key,code=key.length===1 ? 'Key'+key.toUpperCase() : key) => {
    const windowsVirtualKeyCode = key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
  };

  async function cards(selector) {
    return cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),card=>{
      const r=card.getBoundingClientRect(),s=getComputedStyle(card),m=s.transform==='none'?new DOMMatrixReadOnly():new DOMMatrixReadOnly(s.transform);
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,rotation:Math.atan2(m.b,m.a)*180/Math.PI,fan:card.style.getPropertyValue('--fan-angle')};
    })`);
  }

  async function upright(selector,label) {
    const hand = await cards(selector);
    assert.ok(hand.length>0,label+' has cards');
    for (const card of hand) {
      assert.ok(Math.abs(card.rotation)<0.01,label+' cards stay upright: '+JSON.stringify(card));
      assert.equal(card.fan,'',label+' does not carry fan metadata');
    }
    return hand;
  }

  async function blackjackHand(selector,label) {
    const hand = await upright(selector,label);
    for(let i=1;i<hand.length;i++) {
      assert.ok(hand[i].x>hand[i-1].x+1,label+' reveals each new card to the right');
      assert.ok(hand[i].x<hand[i-1].right-1,label+' cards overlap like a dealt blackjack hand');
      assert.ok(Math.abs(hand[i].y-hand[i-1].y)<hand[i].height*0.3,label+' keeps a compact vertical step');
    }
  }

  async function fits(width,height,label) {
    const result = await cdp.evaluate(`(() => {
      const pageY=scrollY;
      const selectors=['.topbar','.control-deck','#game-actions','#wager-total','.chip-selector','#dealer-hand .card','#player-hands .card','#player-hands .total-badge','#community-hand .card','.betting-spots button'];
      const elements=selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector),el=>({selector,el})));
      const rects=elements.filter(({el})=>el.getClientRects().length).map(({selector,el})=>{
        const r=el.getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
      }).filter(r=>r.width&&r.height);
      const actions=Array.from(document.querySelectorAll('#game-actions button:not(:disabled),#deal-btn:not(:disabled)')).filter(el=>el.getClientRects().length).map(el=>{
        el.scrollIntoView({block:'center',inline:'center'});
        const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {label:el.textContent,reachable:el===hit||el.contains(hit)};
      });
      return {rects,actions,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY:pageY};
    })()`);
    for(const r of result.rects) assert.ok(r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1,`${label} ${width}x${height}: ${r.selector} fits (${JSON.stringify(r)})`);
    assert.ok(result.scrollWidth<=width,`${label} ${width}x${height}: no horizontal scroll`);
    assert.ok(result.scrollHeight<=height && result.scrollY===0,`${label} ${width}x${height}: no vertical scroll`);
    assert.ok(result.actions.length>0,label+': actions are visible');
    for(const action of result.actions) assert.equal(action.reachable,true,label+': action not covered: '+action.label);
  }

  async function rigBlackjack(sequence) {
    await cdp.evaluate(`(() => {
      const original=CasinoEngine.createBlackjack;
      CasinoEngine.createBlackjack=bet=>{
        CasinoEngine.createBlackjack=original;
        return original(bet,${JSON.stringify(sequence)}.split(' ').map(token=>({rank:token.slice(0,-1),suit:token.slice(-1)})).reverse());
      };
    })()`);
  }

  try {
    await viewport(1365,768);
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await cdp.send('Page.navigate',{url:pathToFileURL(path.join(ROOT,'index.html')).href});
    await cdp.waitFor(`document.readyState==='complete'&&!!window.CasinoEngine`,'game load');

    await rigBlackjack('5S 10H 4D 7C 3H 2C 2S 2D');
    await cdp.evaluate(`document.activeElement?.blur()`);
    await press('Enter');
    await decision();
    await blackjackHand('#player-hands .card','Blackjack opening hand');
    await blackjackHand('#dealer-hand .card','Blackjack dealer');
    await press('h');
    await decision();
    assert.equal((await saved()).round.hands[0].cards.length,3,'H draws exactly one card');
    await blackjackHand('#player-hands .card','Blackjack three-card hand');

    const beforeDialog=await saved();
    await cdp.click('[data-open="rules"]');
    await press('s');
    assert.deepEqual(await saved(),beforeDialog,'A shortcut inside a modal cannot change the hand');
    await cdp.click('#dialog-close');
    for(const [width,height] of VIEWPORTS) {
      await viewport(width,height);
      await fits(width,height,'Blackjack');
      await blackjackHand('#player-hands .card','Blackjack '+width+'x'+height);
      await cdp.screenshot('redesign-blackjack-'+width+'x'+height+'.png');
    }
    await press('s');
    await settled();
    console.log('PASS Upright overlapping blackjack, one-card keyboard hit, modal keyboard guard, six viewport sizes.');

    await viewport(1365,768);
    await rigBlackjack('8S 10H 8D 7C 8H 8C 2D 3S 3H 2C 2S 2D 2H 10S');
    await cdp.click('#deal-btn');
    await decision();
    for(let i=0;i<3;i++) {
      await cdp.click('[data-action="split"]');
      await decision();
    }
    assert.equal((await saved()).round.hands.length,4);
    for(let i=0;i<3;i++) { await press('h'); await decision(); }
    assert.equal((await saved()).round.hands[0].cards.length,5,'A split hand can take several hits');
    for(const [width,height] of [[1365,768],[390,844],[360,640],[844,390]]) {
      await viewport(width,height);
      await fits(width,height,'Four split hands');
      for(let i=1;i<=4;i++) await blackjackHand('#player-hands .player-hand:nth-child('+i+') .card','Split hand '+i);
      const groups=await cdp.evaluate(`Array.from(document.querySelectorAll('#player-hands .player-hand'),hand=>{
        const cards=Array.from(hand.querySelectorAll('.card'),el=>el.getBoundingClientRect());
        return {left:Math.min(...cards.map(r=>r.left)),right:Math.max(...cards.map(r=>r.right)),top:Math.min(...cards.map(r=>r.top)),bottom:Math.max(...cards.map(r=>r.bottom))};
      })`);
      for(let i=0;i<groups.length;i++) for(let j=i+1;j<groups.length;j++) {
        const a=groups[i],b=groups[j];
        assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'Separate split hands cannot cover one another at '+width+'x'+height);
      }
      await cdp.screenshot('redesign-splits-'+width+'x'+height+'.png');
    }
    for(let i=0;i<4;i++) {
      await cdp.click('[data-action="stand"]');
      if(i<3) await decision();
    }
    await settled();
    console.log('PASS Four blackjack split hands remain upright, overlapping and inside desktop/mobile/landscape viewports.');

    await viewport(1365,768);
    await cdp.click('#tab-ultimate');
    await cdp.click('#quick-guide');
    assert.equal(await cdp.evaluate(`document.querySelector('#info-dialog').open`),true,'Quick guide opens');
    await cdp.click('#dialog-close');
    await cdp.click('#deal-btn');
    await decision();
    assert.equal(await cdp.evaluate(`document.querySelector('#table-result').hidden`),true,'Result is hidden while choosing a play');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#round-stage .is-current').length`),1,'Current round stage is clear');
    await press('c');
    await decision();
    assert.equal((await saved()).round.phase,'flop','C checks through to the flop');
    await press('c');
    await decision();
    assert.equal((await saved()).round.phase,'river','C checks through to the river');
    const beforeIllegalPlay=await saved();
    await press('4','Digit4');
    assert.deepEqual(await saved(),beforeIllegalPlay,'Unavailable 4× shortcut cannot make a wager at the river');
    for(const [width,height] of VIEWPORTS) {
      await viewport(width,height);
      await fits(width,height,'Ultimate Hold’em');
      const player=await cards('#player-hands .card');
      assert.equal(player.length,2,'Only the two hole cards belong to the fan');
      assert.ok(player[0].rotation<-1&&player[1].rotation>1,'The two Ultimate hole cards flare outward');
      const dealer=await upright('#dealer-hand .card','Ultimate dealer');
      const board=await upright('#community-hand .card','Community board');
      assert.equal(dealer.length,2);
      assert.equal(board.length,5);
      for (const held of player) for (const laid of [...dealer,...board]) {
        assert.ok(held.right<=laid.x || laid.right<=held.x || held.bottom<=laid.y || laid.bottom<=held.y,
          'Hole cards never cover the dealer or community board at '+width+'x'+height);
      }
      for(const row of [dealer,board]) for(let i=1;i<row.length;i++) {
        assert.ok(Math.abs(row[i].y-row[0].y)<=23,'Rows share a baseline except for raised qualifying cards');
        assert.ok(row[i].x>=row[i-1].right-1,'Dealer and community cards are separate, straight cards');
      }
      assert.equal(await cdp.evaluate(`document.querySelectorAll('.card[style*="--fan-angle"]').length`),2,'Fan metadata is scoped exclusively to Ultimate hole cards');
      await cdp.screenshot('redesign-ultimate-'+width+'x'+height+'.png');
    }
    await press('1','Digit1');
    await settled();
    assert.equal((await saved()).round.play,25,'1 keyboard shortcut places the legal river wager');
    assert.equal(await cdp.evaluate(`document.querySelector('#table-result').hidden`),false,'Settled result is visible');
    await upright('#dealer-hand .card','Revealed Ultimate dealer');
    await upright('#community-hand .card','Settled community board');
    for(const [width,height] of VIEWPORTS) {
      await viewport(width,height);
      await fits(width,height,'Settled Ultimate');
      const separated = await cdp.evaluate(`(() => {
        const result=document.querySelector('#table-result').getBoundingClientRect();
        return Array.from(document.querySelectorAll('#dealer-hand .card,#community-hand .card,#player-hands .card')).every(card=>{
          const r=card.getBoundingClientRect();return result.right<=r.x||r.right<=result.x||result.bottom<=r.y||r.bottom<=result.y;
        });
      })()`);
      assert.equal(separated,true,'The result never obscures a card at '+width+'x'+height);
      await cdp.screenshot('redesign-result-'+width+'x'+height+'.png');
    }
    console.log('PASS Only Ultimate hole cards flare; all dealer and community cards stay upright, organized and visible in six sizes.');

    await viewport(1365,768);
    const beforeFullscreen=await saved();
    await cdp.click('#fullscreen-btn');
    await cdp.waitFor(`!!document.fullscreenElement&&document.querySelector('#fullscreen-btn').getAttribute('aria-pressed')==='true'`,'fullscreen entry');
    await cdp.click('[data-open="rules"]');
    assert.equal(await cdp.evaluate(`document.querySelector('#info-dialog').open`),true);
    await cdp.click('#dialog-close');
    await press('Escape');
    await cdp.waitFor(`!document.fullscreenElement&&document.querySelector('#fullscreen-btn').getAttribute('aria-pressed')==='false'`,'fullscreen exit');
    assert.deepEqual(await saved(),beforeFullscreen,'Fullscreen and modal controls preserve the session');
    assert.deepEqual(errors,[],'No browser JavaScript errors');
    console.log('PASS Native fullscreen, fullscreen modal access, Escape, state preservation and zero browser errors.');
  } catch(error) {
    try {await cdp.screenshot('redesign-failure.png');} catch { /* Preserve the original assertion. */ }
    throw error;
  } finally {await session.close();}
}

run().catch(error=>{console.error(error);process.exitCode=1;});
