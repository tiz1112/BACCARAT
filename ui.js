/* ============================================================
   ui.js — 画面を描く係

   engine.js が出した結果を受け取って、見た目に変換するだけ。
   ルールの判断はここでは一切しない。
============================================================ */

const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR = { s: 'black', h: 'red', d: 'red', c: 'black' };

const CHIP_VALUES = [100, 500, 1000, 5000, 10000];
const CHIP_LABEL = { 100: '100', 500: '500', 1000: '1K', 5000: '5K', 10000: '10K' };
const CHIP_COLOR = {
    100: '#2a2a32', 500: '#a81e2e', 1000: '#1e5aa8',
    5000: '#a8691e', 10000: '#5f2aa0'
};

const UI = {
    el: {},

    init() {
        // よく使う要素をまとめて覚えておく
        const ids = [
            'shoeRemaining', 'balance', 'commissionToggle', 'commissionLabel', 'bankerOdds',
            'playerCards', 'bankerCards', 'playerTotal', 'bankerTotal',
            'resultBar', 'stats', 'chipRack', 'dealBtn', 'clearBtn', 'rebetBtn',
            'bigRoad', 'bigEye', 'smallRoad', 'cockroach', 'shuffleOverlay', 'newShoeBtn'
        ];
        ids.forEach(id => this.el[id] = document.getElementById(id));

        this.el.playerSide = document.querySelector('.player-side');
        this.el.bankerSide = document.querySelector('.banker-side');
        this.el.spots = document.querySelectorAll('.bet-spot');
    },

    /* --------------------------------------------------------
       チップラックを作る
    -------------------------------------------------------- */
    renderChips(selected, balance) {
        this.el.chipRack.innerHTML = '';
        for (const v of CHIP_VALUES) {
            const btn = document.createElement('button');
            btn.className = `chip chip-${v}` + (v === selected ? ' selected' : '');
            btn.dataset.value = v;
            btn.innerHTML = `<span>${CHIP_LABEL[v]}</span>`;
            btn.disabled = v > balance;
            this.el.chipRack.appendChild(btn);
        }
    },

    /* --------------------------------------------------------
       ベットエリアに積まれたチップを描く
    -------------------------------------------------------- */
    renderBets(bets) {
        for (const [spot, amount] of Object.entries(bets)) {
            const box = document.getElementById('chips-' + spot);
            if (!box) continue;

            if (amount === 0) {
                box.innerHTML = '';
                continue;
            }

            // 額面の大きいチップから崩していって、何枚積むかを決める
            const stack = [];
            let rest = amount;
            for (const v of [...CHIP_VALUES].reverse()) {
                while (rest >= v && stack.length < 5) {
                    stack.push(v);
                    rest -= v;
                }
            }

            const chips = stack
                .map(v => `<span class="mini-chip" style="background:${CHIP_COLOR[v]}"></span>`)
                .join('');

            box.innerHTML = `<span class="stack">${chips}</span>${amount.toLocaleString()}`;
        }
    },

    /* --------------------------------------------------------
       トランプを1枚作る
    -------------------------------------------------------- */
    createCard(card, isThird) {
        const el = document.createElement('div');
        el.className = `card ${SUIT_COLOR[card.suit]}` + (isThird ? ' third' : '');
        el.innerHTML =
            `<span class="rank">${card.rank}</span>` +
            `<span class="suit-small">${SUIT_MARK[card.suit]}</span>` +
            `<span class="suit-big">${SUIT_MARK[card.suit]}</span>`;
        return el;
    },

    /** カードを1枚配る（表示するだけ） */
    dealCard(side, card, index) {
        const box = side === 'player' ? this.el.playerCards : this.el.bankerCards;
        box.appendChild(this.createCard(card, index >= 2));
    },

    /** 場をきれいにする */
    clearTable() {
        this.el.playerCards.innerHTML = '';
        this.el.bankerCards.innerHTML = '';
        this.el.playerTotal.textContent = '—';
        this.el.bankerTotal.textContent = '—';
        this.el.resultBar.innerHTML = '';
        this.el.playerSide.classList.remove('win');
        this.el.bankerSide.classList.remove('win');
        this.el.spots.forEach(s => s.classList.remove('won'));
    },

    setTotal(side, total) {
        const el = side === 'player' ? this.el.playerTotal : this.el.bankerTotal;
        el.textContent = total;
    },

    /* --------------------------------------------------------
       結果を出す
    -------------------------------------------------------- */
    showResult(result, settlement) {
        if (result.outcome === 'player') this.el.playerSide.classList.add('win');
        if (result.outcome === 'banker') this.el.bankerSide.classList.add('win');

        const name = { player: 'PLAYER', banker: 'BANKER', tie: 'TIE' }[result.outcome];

        // 当たった札に印を付ける
        const tags = [];
        if (result.natural) tags.push('NATURAL');
        if (result.playerPair) tags.push('P PAIR');
        if (result.bankerPair) tags.push('B PAIR');

        const net = settlement.net;
        const netClass = net > 0 ? 'plus' : (net < 0 ? 'minus' : '');
        const netText = net === 0 ? '±0' : (net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString());

        this.el.resultBar.innerHTML =
            `<span class="result-main ${result.outcome}">${name}</span>` +
            (tags.length ? `<span class="result-tags">${tags.map(t => `<span class="result-tag">${t}</span>`).join('')}</span>` : '') +
            `<span class="result-net ${netClass}">${netText}</span>`;

        // 当たったベットエリアを光らせる
        settlement.detail
            .filter(d => d.amount > 0)
            .forEach(d => {
                const key = { 'PLAYER': 'player', 'BANKER': 'banker', 'TIE': 'tie', 'P PAIR': 'pPair', 'B PAIR': 'bPair' }[d.name];
                const spot = document.querySelector(`.bet-spot[data-spot="${key}"]`);
                if (spot) spot.classList.add('won');
            });
    },

    /* --------------------------------------------------------
       上部バーの更新
    -------------------------------------------------------- */
    setBalance(value, diff) {
        this.el.balance.textContent = value.toLocaleString();
        if (diff > 0) this.flash('flash-up');
        if (diff < 0) this.flash('flash-down');
    },

    flash(cls) {
        const el = this.el.balance;
        el.classList.remove('flash-up', 'flash-down');
        void el.offsetWidth;                  // アニメーションをやり直させるための小技
        el.classList.add(cls);
    },

    setShoe(remaining) {
        this.el.shoeRemaining.textContent = remaining;
    },

    setCommissionLabel(on) {
        this.el.commissionLabel.textContent = on ? 'COMMISSION' : 'NO COMMISSION';
        this.el.bankerOdds.textContent = on ? '1:1 −5%' : '1:1 / 6は半額';
    },

    setButtons({ deal, clear, rebet }) {
        this.el.dealBtn.disabled = !deal;
        this.el.clearBtn.disabled = !clear;
        this.el.rebetBtn.disabled = !rebet;
    },

    /* --------------------------------------------------------
       罫線を描く（canvas）
    -------------------------------------------------------- */
    drawBigRoad(grid) {
        const cell = 22, rows = 6;
        const canvas = this.el.bigRoad;
        const cols = Math.max(grid.length + 2, 26);
        const dpr = window.devicePixelRatio || 1;

        canvas.width = cols * cell * dpr;
        canvas.height = rows * cell * dpr;
        canvas.style.width = cols * cell + 'px';
        canvas.style.height = rows * cell + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cols * cell, rows * cell);
        this.drawGrid(ctx, cols, rows, cell);

        grid.forEach((col, ci) => {
            if (!col) return;
            col.forEach((c, ri) => {
                if (!c) return;
                const x = ci * cell + cell / 2;
                const y = ri * cell + cell / 2;
                const r = cell / 2 - 3.5;

                // タイだけが単独で出たときは緑の丸
                if (c.outcome === 'tie') {
                    ctx.strokeStyle = '#1a9a5a';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.stroke();
                } else {
                    ctx.strokeStyle = c.outcome === 'player' ? '#1e5aa8' : '#c0202a';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // タイが重なっていたら斜線を引く
                if (c.ties > 0) {
                    ctx.strokeStyle = '#1a9a5a';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(x - r, y + r);
                    ctx.lineTo(x + r, y - r);
                    ctx.stroke();

                    // 2回以上続いたら数字を添える
                    if (c.ties > 1) {
                        ctx.fillStyle = '#1a9a5a';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(c.ties, x + r - 2, y + r - 1);
                    }
                }

                // ペアは左上（プレイヤー）と右下（バンカー）に点
                if (c.pPair) {
                    ctx.fillStyle = '#1e5aa8';
                    ctx.beginPath();
                    ctx.arc(x - r + 1, y - r + 1, 2.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                if (c.bPair) {
                    ctx.fillStyle = '#c0202a';
                    ctx.beginPath();
                    ctx.arc(x + r - 1, y + r - 1, 2.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        });

        this.scrollRoadToEnd(canvas);
    },

    /**
     * 派生罫線（大眼仔・小路・甲由路）を描く。
     * 大眼仔は丸、小路は塗りつぶし、甲由路は斜線で区別する。
     */
    drawDerived(canvasKey, grid, style) {
        const cell = 11, rows = 6;
        const canvas = this.el[canvasKey];
        const cols = Math.max(grid.length + 2, 24);
        const dpr = window.devicePixelRatio || 1;

        canvas.width = cols * cell * dpr;
        canvas.height = rows * cell * dpr;
        canvas.style.width = cols * cell + 'px';
        canvas.style.height = rows * cell + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cols * cell, rows * cell);
        this.drawGrid(ctx, cols, rows, cell);

        grid.forEach((col, ci) => {
            if (!col) return;
            col.forEach((m, ri) => {
                if (!m) return;
                const x = ci * cell + cell / 2;
                const y = ri * cell + cell / 2;
                const r = cell / 2 - 2;
                const color = m === 'red' ? '#c0202a' : '#1e5aa8';

                if (style === 'fill') {
                    // 小路：塗りつぶした丸
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                } else if (style === 'slash') {
                    // 甲由路：斜線
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.moveTo(x - r, y + r);
                    ctx.lineTo(x + r, y - r);
                    ctx.stroke();
                } else {
                    // 大眼仔：輪郭だけの丸
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.stroke();
                }
            });
        });

        this.scrollRoadToEnd(canvas);
    },

    /** 罫線の背景の方眼 */
    drawGrid(ctx, cols, rows, cell) {
        ctx.strokeStyle = '#e4e4e4';
        ctx.lineWidth = 1;
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cell + .5, 0);
            ctx.lineTo(c * cell + .5, rows * cell);
            ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cell + .5);
            ctx.lineTo(cols * cell, r * cell + .5);
            ctx.stroke();
        }
    },

    /** 新しい結果が見えるように右端へスクロール */
    scrollRoadToEnd(canvas) {
        const box = canvas.parentElement;
        box.scrollLeft = box.scrollWidth;
    },

    /* --------------------------------------------------------
       統計
    -------------------------------------------------------- */
    renderStats(s) {
        const pct = (n) => s.total ? ((n / s.total) * 100).toFixed(1) : '0.0';
        this.el.stats.innerHTML =
            `<span>GAMES <b>${s.total}</b></span>` +
            `<span class="s-banker">BANKER <b>${s.banker}</b>(${pct(s.banker)}%)</span>` +
            `<span class="s-player">PLAYER <b>${s.player}</b>(${pct(s.player)}%)</span>` +
            `<span class="s-tie">TIE <b>${s.tie}</b>(${pct(s.tie)}%)</span>` +
            `<span>P PAIR <b>${s.pPair}</b></span>` +
            `<span>B PAIR <b>${s.bPair}</b></span>`;
    },

    showShuffle(show) {
        this.el.shuffleOverlay.classList.toggle('show', show);
    }
};