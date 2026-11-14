/* ============================================================
   main.js — ゲームの進行役

   engine.js（ルール）と ui.js（画面）をつなぐ。
   「今はベットを受け付ける時間か、配っている最中か」といった
   状態の管理もここで行う。
============================================================ */

const STORAGE_KEY = 'baccarat.state';

const Game = {
    shoe: null,
    balance: 100000,
    bets: { player: 0, banker: 0, tie: 0, pPair: 0, bPair: 0 },
    lastBets: null,
    history: [],
    selectedChip: 1000,
    commission: true,
    phase: 'betting',        // betting → dealing → result
    shoeEnding: false,

    /* --------------------------------------------------------
       起動
    -------------------------------------------------------- */
    init() {
        UI.init();
        this.load();
        if (!this.shoe) this.shoe = new Shoe(8);
        this.bindEvents();
        this.refresh();
    },

    /* --------------------------------------------------------
       保存と復元
       シューの中身まで保存すると、閉じても同じ流れが続く
    -------------------------------------------------------- */
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                balance: this.balance,
                history: this.history,
                commission: this.commission,
                selectedChip: this.selectedChip,
                lastBets: this.lastBets,
                shoe: {
                    cards: this.shoe.cards,
                    cutPosition: this.shoe.cutPosition,
                    deckCount: this.shoe.deckCount
                }
            }));
        } catch (e) {
            // 保存に失敗してもゲームは続けられるので、黙って流す
        }
    },

    load() {
        let data;
        try {
            data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            data = null;
        }
        if (!data) return;

        this.balance = data.balance ?? 100000;
        this.history = data.history ?? [];
        this.commission = data.commission ?? true;
        this.selectedChip = data.selectedChip ?? 1000;
        this.lastBets = data.lastBets ?? null;

        if (data.shoe && Array.isArray(data.shoe.cards) && data.shoe.cards.length > 0) {
            this.shoe = new Shoe(data.shoe.deckCount || 8);
            this.shoe.cards = data.shoe.cards;
            this.shoe.cutPosition = data.shoe.cutPosition;
        }

        UI.el.commissionToggle.checked = this.commission;
    },

    /* --------------------------------------------------------
       操作の受付
    -------------------------------------------------------- */
    bindEvents() {
        // チップを選ぶ
        UI.el.chipRack.addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip || chip.disabled) return;
            this.selectedChip = Number(chip.dataset.value);
            UI.renderChips(this.selectedChip, this.balance);
        });

        // ベットエリアを押す
        document.querySelectorAll('.bet-spot').forEach(spot => {
            spot.addEventListener('click', () => this.placeBet(spot.dataset.spot));
            // 右クリックで1チップ分だけ戻す
            spot.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.removeBet(spot.dataset.spot);
            });
        });

        UI.el.dealBtn.addEventListener('click', () => this.deal());
        UI.el.clearBtn.addEventListener('click', () => this.clearBets());
        UI.el.rebetBtn.addEventListener('click', () => this.rebet());
        UI.el.newShoeBtn.addEventListener('click', () => this.newShoe());

        UI.el.commissionToggle.addEventListener('change', (e) => {
            this.commission = e.target.checked;
            UI.setCommissionLabel(this.commission);
            this.save();
        });

        // キーボードでも操作できるようにしておく
        document.addEventListener('keydown', (e) => {
            if (this.phase !== 'betting') return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.deal(); }
            if (e.key === 'p' || e.key === 'P') this.placeBet('player');
            if (e.key === 'b' || e.key === 'B') this.placeBet('banker');
            if (e.key === 't' || e.key === 'T') this.placeBet('tie');
            if (e.key === 'c' || e.key === 'C') this.clearBets();
            if (e.key === 'r' || e.key === 'R') this.rebet();
        });
    },

    /* --------------------------------------------------------
       ベット
    -------------------------------------------------------- */
    placeBet(spot) {
        if (this.phase !== 'betting') return;
        if (this.selectedChip > this.balance) return;

        this.balance -= this.selectedChip;
        this.bets[spot] += this.selectedChip;
        this.refresh();
    },

    removeBet(spot) {
        if (this.phase !== 'betting') return;
        if (this.bets[spot] <= 0) return;

        const back = Math.min(this.selectedChip, this.bets[spot]);
        this.bets[spot] -= back;
        this.balance += back;
        this.refresh();
    },

    clearBets() {
        if (this.phase !== 'betting') return;
        const total = this.totalBet();
        this.balance += total;
        this.bets = { player: 0, banker: 0, tie: 0, pPair: 0, bPair: 0 };
        this.refresh();
    },

    rebet() {
        if (this.phase !== 'betting' || !this.lastBets) return;

        const needed = Object.values(this.lastBets).reduce((a, b) => a + b, 0);
        const current = this.totalBet();
        if (needed - current > this.balance) return;

        this.balance += current;
        this.bets = { ...this.lastBets };
        this.balance -= needed;
        this.refresh();
    },

    totalBet() {
        return Object.values(this.bets).reduce((a, b) => a + b, 0);
    },

    /* --------------------------------------------------------
       配る
    -------------------------------------------------------- */
    async deal() {
        if (this.phase !== 'betting') return;
        if (this.totalBet() === 0) return;

        this.phase = 'dealing';
        this.lastBets = { ...this.bets };
        UI.clearTable();
        UI.setButtons({ deal: false, clear: false, rebet: false });

        const result = playRound(this.shoe);

        // 記録に残した順番どおりに、1枚ずつ場へ出す
        const indexes = { player: 0, banker: 0 };
        for (const step of result.steps) {
            await wait(330);
            UI.dealCard(step.side, step.card, indexes[step.side]);
            indexes[step.side]++;

            // 2枚目が出た時点で、いったん点数を見せる
            if (indexes[step.side] === 2) {
                const cards = step.side === 'player'
                    ? result.player.slice(0, 2)
                    : result.banker.slice(0, 2);
                UI.setTotal(step.side, handTotal(cards));
            }
            UI.setShoe(this.shoe.remaining);
        }

        // 3枚目まで出そろった最終の点数
        await wait(220);
        UI.setTotal('player', result.playerTotal);
        UI.setTotal('banker', result.bankerTotal);

        await wait(420);

        // 精算
        const settlement = settle(this.bets, result, this.commission);
        const before = this.balance;
        this.balance += settlement.payout;

        this.history.push({
            outcome: result.outcome,
            playerPair: result.playerPair,
            bankerPair: result.bankerPair
        });

        UI.showResult(result, settlement);
        UI.setBalance(this.balance, this.balance - before - this.totalBet());
        this.drawRoads();
        this.save();

        this.phase = 'result';
        await wait(1500);

        // 次のゲームへ
        this.bets = { player: 0, banker: 0, tie: 0, pPair: 0, bPair: 0 };
        this.phase = 'betting';

        // 資金が尽きたら補充する（練習用なので破産しても続けられる）
        if (this.balance < 100) {
            this.balance = 100000;
            UI.setBalance(this.balance, 1);
        }

        // カットカードが出ていたら、ここでシュー交換
        if (this.shoe.needsShuffle) {
            UI.showShuffle(true);
        }

        this.refresh();
    },

    newShoe() {
        this.shoe.reset();
        this.history = [];
        UI.showShuffle(false);
        UI.clearTable();
        this.drawRoads();
        this.save();
        this.refresh();
    },

    /* --------------------------------------------------------
       表示の更新
    -------------------------------------------------------- */
    refresh() {
        UI.renderChips(this.selectedChip, this.balance);
        UI.renderBets(this.bets);
        UI.setBalance(this.balance, 0);
        UI.setShoe(this.shoe.remaining);
        UI.setCommissionLabel(this.commission);
        UI.setButtons({
            deal: this.phase === 'betting' && this.totalBet() > 0,
            clear: this.phase === 'betting' && this.totalBet() > 0,
            rebet: this.phase === 'betting' && !!this.lastBets
        });
        this.drawRoads();
    },

    drawRoads() {
        const bigRoad = buildBigRoad(this.history);
        UI.drawBigRoad(bigRoad);
        UI.drawDerived('bigEye', marksToGrid(buildBigEyeBoy(bigRoad)), 'ring');
        UI.drawDerived('smallRoad', marksToGrid(buildSmallRoad(bigRoad)), 'fill');
        UI.drawDerived('cockroach', marksToGrid(buildCockroachPig(bigRoad)), 'slash');
        UI.renderStats(buildStats(this.history));
    }
};

/** 指定ミリ秒だけ待つ。配る間合いを作るために使う */
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

document.addEventListener('DOMContentLoaded', () => Game.init());