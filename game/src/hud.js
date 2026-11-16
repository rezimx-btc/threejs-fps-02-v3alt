// EMBERLINE — the HUD. One module owns every DOM readout: health, ammo,
// money, timer, score, compass, killfeed, damage direction, the buy menu,
// banners and the end screens. It caches the last values it wrote so the
// DOM is only touched when something actually changes. It also owns the
// pointer-lock fallback hint: when the browser cannot lock the cursor, the
// game still plays by dragging, and this line tells the player so.
import { WEAPONS, GRENADES } from './weapon.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const cache = {};
  const feed = el('killfeed');
  const feedItems = [];

  function setText(id, value) {
    if (cache[id] === value) return;
    cache[id] = value;
    const node = el(id);
    if (node) node.textContent = value;
  }

  function setBar(id, frac) {
    const key = id + ':bar';
    const v = Math.round(frac * 100);
    if (cache[key] === v) return;
    cache[key] = v;
    const node = el(id);
    if (node) node.style.width = v + '%';
  }

  return {
    setHealth(hp, armor) {
      setText('health-num', String(Math.ceil(hp)));
      setBar('health-fill', Math.max(0, hp) / 100);
      setText('armor-num', armor > 0 ? '+' + Math.ceil(armor) : '');
      const low = el('health-wrap');
      if (low) low.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, reloading) {
      setText('ammo-mag', String(mag));
      setText('ammo-reserve', '/ ' + reserve);
      const node = el('ammo');
      if (node) node.classList.toggle('reloading', reloading);
    },
    setMoney(money) {
      setText('money', '$' + money);
    },
    setScore(ember, slag) {
      setText('score-e', String(ember));
      setText('score-s', String(slag));
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText('timer', mm + ':' + ss);
      const node = el('timer');
      if (node) node.classList.toggle('urgent', phase === 'live' && s <= 15);
    },
    setRound(n) {
      setText('round-num', 'R' + n);
    },
    setObjective(text) {
      setText('objective', text);
    },
    setCharge(stateName, value) {
      const bar = el('charge-bar');
      const label = el('charge-label');
      if (!bar || !label) return;
      if (stateName === 'planted') {
        bar.style.display = 'block';
        label.textContent = 'DETONATION ' + Math.ceil(value) + 's';
        const fill = el('charge-fill');
        if (fill) fill.style.width = Math.max(0, (value / 30) * 100) + '%';
      } else if (stateName === 'planting' || stateName === 'defusing') {
        bar.style.display = 'block';
        label.textContent = stateName === 'planting' ? 'PLANTING…' : 'DEFUSING…';
        const fill = el('charge-fill');
        if (fill) fill.style.width = Math.round(value * 100) + '%';
      } else {
        bar.style.display = 'none';
      }
    },
    setHostages(following, rescued = 0) {
      setText('hostages', `Hostages ${rescued}/2 safe${following > 0 ? ' · ' + following + ' following' : ''}`);
    },
    setWeapon(name, grenadeName, grenadeCount) {
      setText('weapon-name', name);
      setText('grenade-name', grenadeName + (grenadeCount > 0 ? ' ×' + grenadeCount : ' —'));
    },
    setCrosshair(spreadPx) {
      const node = el('crosshair');
      if (node) node.style.setProperty('--gap', Math.round(spreadPx) + 'px');
    },
    setLockHint(visible) {
      const node = el('lock-hint');
      if (node) node.style.display = visible ? 'block' : 'none';
    },
    hitmarker(kill) {
      const node = el('hitmarker');
      if (!node) return;
      node.classList.add('on');
      node.classList.toggle('kill', !!kill);
      clearTimeout(node._t);
      if (document.body.classList.contains('shot-mode')) return;
      node._t = setTimeout(() => node.classList.remove('on', 'kill'), 110);
    },
    damageFrom(angleRad) {
      const node = el('dmg-dir');
      if (!node) return;
      node.style.transform = `translate(-50%,-50%) rotate(${angleRad}rad)`;
      node.classList.add('on');
      clearTimeout(node._t);
      node._t = setTimeout(() => node.classList.remove('on'), 600);
    },
    flash(amount) {
      const node = el('flash');
      if (!node) return;
      node.style.opacity = String(Math.min(1, amount));
    },
    killfeed(text, good) {
      const div = document.createElement('div');
      div.className = 'feed-item' + (good ? ' good' : ' bad');
      div.textContent = text;
      feed.prepend(div);
      feedItems.push(div);
      while (feedItems.length > 5) feedItems.shift().remove();
      // In deterministic ?shot= mode the frame is frozen for capture, so
      // transient entries stay put instead of fading on a real-time clock.
      if (document.body.classList.contains('shot-mode')) return;
      setTimeout(() => {
        div.classList.add('fade');
        setTimeout(() => div.remove(), 900);
      }, 4200);
    },
    setCompass(yaw, markers) {
      const strip = el('compass-strip');
      if (!strip) return;
      // Yaw 0 faces north (-Z). Bearing of a marker relative to view.
      let html = '';
      const width = 520;
      for (const m of markers) {
        let rel = m.bearing - yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        // Markers to the player's right (bearing < yaw) sit right of centre.
        const x = width / 2 - (rel / (Math.PI * 0.9)) * (width / 2);
        if (x < -20 || x > width + 20) continue;
        html += `<span class="compass-mark ${m.cls}" style="left:${x.toFixed(0)}px">${m.label}</span>`;
      }
      // Cardinal ticks every 45 deg.
      const dirs = [['N', 0], ['NE', Math.PI / 4], ['E', Math.PI / 2], ['SE', (3 * Math.PI) / 4], ['S', Math.PI], ['SW', (5 * Math.PI) / 4], ['W', (3 * Math.PI) / 2], ['NW', (7 * Math.PI) / 4]];
      for (const [label, bearing] of dirs) {
        let rel = bearing - yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        const x = width / 2 - (rel / (Math.PI * 0.9)) * (width / 2);
        if (x < 0 || x > width) continue;
        html += `<span class="compass-tick" style="left:${x.toFixed(0)}px">${label}</span>`;
      }
      if (cache.compass !== html) {
        cache.compass = html;
        strip.innerHTML = html;
      }
    },
    banner(title, sub, ms = 3000) {
      const node = el('banner');
      if (!node) return;
      el('banner-title').textContent = title;
      el('banner-sub').textContent = sub || '';
      node.classList.add('show');
      clearTimeout(node._t);
      node._t = setTimeout(() => node.classList.remove('show'), ms);
    },
    interact(text) {
      const node = el('interact');
      if (!node) return;
      if (text) {
        node.textContent = text;
        node.style.display = 'block';
      } else {
        node.style.display = 'none';
      }
    },
    showOverlay(kind, data = {}) {
      const overlay = el('overlay');
      const title = el('overlay-title');
      const copy = el('overlay-copy');
      const play = el('play');
      if (kind === 'start') {
        title.textContent = 'EMBERLINE';
        copy.textContent = 'Foundry-9: plant the charge at the Furnace or the Gantry — or free both hostages and bring them to extraction. First to 5 rounds takes the match.';
        play.textContent = 'Click to play';
        overlay.hidden = false;
      } else if (kind === 'paused') {
        title.textContent = 'Paused';
        copy.textContent = 'Click to resume. B opens the buy menu.';
        play.textContent = 'Resume';
        overlay.hidden = false;
      } else if (kind === 'dead') {
        title.textContent = 'You are down';
        copy.textContent = 'Your squad fights on. Next round starts soon.';
        play.textContent = 'Spectate';
        overlay.hidden = false;
      } else if (kind === 'end') {
        title.textContent = (data.winner || 'EMBER') + ' TAKES THE MATCH';
        copy.textContent = `Final ${data.scoreE} — ${data.scoreS} · MVP ${data.mvp ? data.mvp.name + ' (' + data.mvp.kills + ' kills)' : '—'}. Press R to play again.`;
        play.textContent = 'Play again';
        overlay.hidden = false;
      } else if (kind === 'hide') {
        overlay.hidden = true;
      }
    },
    setBuyMenu(open, money, owned) {
      const menu = el('buy');
      if (!menu) return;
      menu.style.display = open ? 'block' : 'none';
      if (!open) return;
      setText('buy-money', '$' + money);
      for (const [slot, def] of Object.entries(WEAPONS)) {
        const btn = el('buy-' + slot);
        if (!btn) continue;
        btn.disabled = money < def.price || owned.has(slot);
        btn.querySelector('.buy-price').textContent = owned.has(slot) ? 'OWNED' : '$' + def.price;
      }
      for (const [kind, g] of Object.entries(GRENADES)) {
        const btn = el('buy-g-' + kind);
        if (!btn) continue;
        btn.disabled = money < g.price;
        btn.querySelector('.buy-price').textContent = '$' + g.price;
      }
      const armorBtn = el('buy-armor');
      if (armorBtn) {
        armorBtn.disabled = money < 650;
        armorBtn.querySelector('.buy-price').textContent = '$650';
      }
    },
    onPlay(callback) {
      el('play').addEventListener('click', callback);
    },
    onBuy(callback) {
      for (const slot of Object.keys(WEAPONS)) {
        const btn = el('buy-' + slot);
        if (btn) btn.addEventListener('click', () => callback('weapon', slot));
      }
      for (const kind of Object.keys(GRENADES)) {
        const btn = el('buy-g-' + kind);
        if (btn) btn.addEventListener('click', () => callback('grenade', kind));
      }
      const armor = el('buy-armor');
      if (armor) armor.addEventListener('click', () => callback('armor'));
    },
  };
}
