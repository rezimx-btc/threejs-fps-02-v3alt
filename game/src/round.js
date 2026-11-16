// EMBERLINE — the round state machine and the economy. One module owns the
// match: buy phase, live round, plant/defuse/rescue objectives, win checks,
// money and the MVP. It never touches the DOM or the renderer; it reports
// through hooks the main loop wires to the HUD and audio.
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const CHARGE_TIME = 30;
export const WIN_ROUNDS = 5;

export function createRound(world, hooks) {
  const state = {
    phase: 'menu',
    round: 0,
    score: { ember: 0, slag: 0 },
    timer: 0,
    money: 800,
    kills: {},
    mvp: null,
    charge: { state: 'carried', carrier: 'player', site: 'A', plant: 0, defuse: 0, timer: 0 },
    hostages: [],
  };

  function resetHostages() {
    state.hostages = world.hostageSpots.map((s, i) => ({
      id: i,
      x: s.x,
      y: s.y,
      z: s.z,
      state: 'cell',
      follower: null,
    }));
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.charge = { state: 'carried', carrier: 'player', site: 'A', plant: 0, defuse: 0, timer: 0 };
    resetHostages();
    hooks.setObjective('Buy phase — B for shop. Plant at Furnace or Gantry, or rescue the hostages.');
    hooks.setCharge('carried', 0);
    hooks.setHostages(0);
    hooks.banner(`ROUND ${state.round}`, state.round === 1 ? 'Ember attacks — plant or rescue' : '', 2600);
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live' && state.phase !== 'buy') return;
    state.phase = 'end';
    state.timer = 4.5;
    if (winner === 'ember') state.score.ember += 1;
    else state.score.slag += 1;
    const win = winner === 'ember';
    state.money += win ? 3250 : 1900;
    hooks.setScore(state.score.ember, state.score.slag);
    hooks.setMoney(state.money);
    hooks.banner(win ? 'ROUND WON' : 'ROUND LOST', reason, 4200);
    hooks.sting(win);
    if (state.score.ember >= WIN_ROUNDS || state.score.slag >= WIN_ROUNDS) {
      state.phase = 'match';
      state.timer = 0;
      const mvp = Object.entries(state.kills).sort((a, b) => b[1] - a[1])[0];
      state.mvp = mvp ? { name: mvp[0], kills: mvp[1] } : { name: '—', kills: 0 };
      hooks.matchEnd(state.score.ember > state.score.slag ? 'EMBER' : 'SLAG', state.score, state.mvp);
    }
  }

  function startMatch() {
    state.round = 0;
    state.score = { ember: 0, slag: 0 };
    state.money = 800;
    state.kills = {};
    state.mvp = null;
    startRound();
  }

  return {
    state,
    startMatch,
    startRound,
    beginLive() {
      if (state.phase !== 'buy') return;
      state.phase = 'live';
      state.timer = ROUND_TIME;
      hooks.setObjective('Plant the charge at Furnace or Gantry — or free both hostages.');
    },
    addKill(name) {
      state.kills[name] = (state.kills[name] || 0) + 1;
    },
    addMoney(amount) {
      state.money += amount;
      hooks.setMoney(state.money);
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      hooks.setMoney(state.money);
      return true;
    },
    // --- the charge: plant channel driven by whoever is planting
    startPlant(site, carrier) {
      if (state.charge.state !== 'carried') return false;
      state.charge.state = 'planting';
      state.charge.site = site;
      state.charge.carrier = carrier;
      state.charge.plant = 0;
      hooks.setCharge('planting', 0);
      return true;
    },
    cancelPlant() {
      if (state.charge.state !== 'planting') return;
      state.charge.state = 'carried';
      state.charge.plant = 0;
      hooks.setCharge('carried', 0);
    },
    finishPlant() {
      state.charge.state = 'planted';
      state.charge.timer = CHARGE_TIME;
      state.charge.plant = 1;
      hooks.setCharge('planted', CHARGE_TIME);
      hooks.setObjective('Charge planted — defend it until it blows.');
      hooks.banner('CHARGE PLANTED', `${world.sites[state.charge.site].name} — ${CHARGE_TIME}s to detonation`, 3000);
      hooks.plantSound();
      if (state.charge.carrier === 'player') this.addMoney(300);
    },
    startDefuse() {
      if (state.charge.state !== 'planted') return false;
      state.charge.state = 'defusing';
      state.charge.defuse = 0;
      hooks.setCharge('defusing', state.charge.timer);
      return true;
    },
    cancelDefuse() {
      if (state.charge.state !== 'defusing') return;
      state.charge.state = 'planted';
      state.charge.defuse = 0;
      hooks.setCharge('planted', state.charge.timer);
    },
    finishDefuse() {
      state.charge.state = 'defused';
      hooks.setCharge('defused', 0);
      endRound('slag', 'Charge defused');
    },
    // --- hostages
    freeHostage(id, follower) {
      const h = state.hostages[id];
      if (!h || h.state !== 'cell') return false;
      h.state = 'follow';
      h.follower = follower;
      hooks.setHostages(state.hostages.filter((x) => x.state === 'follow').length);
      hooks.chime();
      return true;
    },
    // One fixed step: timers, channel progress, hostage movement, win checks.
    step(dt, ctx) {
      const s = state;
      if (s.phase === 'buy') {
        s.timer -= dt;
        hooks.setTimer(Math.max(0, s.timer), 'buy');
        if (s.timer <= 0) this.beginLive();
        return;
      }
      if (s.phase === 'end') {
        s.timer -= dt;
        if (s.timer <= 0) {
          hooks.setTimer(0, 'end');
          startRound();
          ctx.onRoundStart(s.round);
        }
        return;
      }
      if (s.phase !== 'live') return;
      s.timer -= dt;
      hooks.setTimer(Math.max(0, s.timer), 'live');

      // Plant channel progress (player or bot).
      if (s.charge.state === 'planting') {
        s.charge.plant += dt / PLANT_TIME;
        hooks.setCharge('planting', s.charge.plant);
        if (s.charge.plant >= 1) this.finishPlant();
      } else if (s.charge.state === 'defusing') {
        s.charge.defuse += dt / DEFUSE_TIME;
        hooks.setCharge('defusing', s.charge.defuse);
        if (s.charge.defuse >= 1) this.finishDefuse();
      } else if (s.charge.state === 'planted') {
        s.charge.timer -= dt;
        hooks.setCharge('planted', Math.max(0, s.charge.timer));
        if (Math.ceil(s.charge.timer) !== Math.ceil(s.charge.timer + dt)) hooks.beep(s.charge.timer <= 5);
        if (s.charge.timer <= 0) {
          s.charge.state = 'detonated';
          hooks.explosion();
          endRound('ember', 'Charge detonated at ' + world.sites[s.charge.site].name);
          return;
        }
      }

      // Hostages follow their rescuer; reaching extraction rescues them.
      let rescued = 0;
      for (const h of s.hostages) {
        if (h.state === 'follow' && h.follower) {
          const f = h.follower;
          const fx = f.position ? f.position.x : f.x;
          const fz = f.position ? f.position.z : f.z;
          const dx = fx - h.x;
          const dz = fz - h.z;
          const d = Math.hypot(dx, dz);
          if (d > 1.6) {
            const sp = 2.7 * dt;
            h.x += (dx / d) * sp;
            h.z += (dz / d) * sp;
          }
          const ex = world.extraction;
          if (h.x >= ex.x0 && h.x <= ex.x1 && h.z >= ex.z0 && h.z <= ex.z1) {
            h.state = 'rescued';
            h.follower = null;
            this.addMoney(600);
            hooks.banner('HOSTAGE RESCUED', 'One hostage safe at extraction', 2600);
            hooks.chime();
          }
        }
        if (h.state === 'rescued') rescued += 1;
      }
      hooks.setHostages(s.hostages.filter((x) => x.state === 'follow').length, rescued);
      if (rescued >= 2) {
        endRound('ember', 'Both hostages rescued');
        return;
      }

      // Elimination + timeout.
      const emberAlive = ctx.player.alive ? 1 : 0;
      const emberBots = ctx.bots.filter((b) => b.team === 'ember' && b.alive).length;
      const slagBots = ctx.bots.filter((b) => b.team === 'slag' && b.alive).length;
      if (emberAlive + emberBots === 0) {
        endRound('slag', 'Ember team eliminated');
        return;
      }
      if (slagBots === 0) {
        endRound('ember', 'Slag team eliminated');
        return;
      }
      if (s.timer <= 0) {
        endRound('slag', 'Time expired — site held');
      }
    },
  };
}
