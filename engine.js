/* ============================================================
   engine.js — バカラのルールそのもの（画面には一切触れない）

   ここに書いてあるのは「カジノの卓の上で起きること」だけ。
   ・シュー（8デッキの靴）の管理
   ・配牌とサードカード・ルール
   ・勝敗判定と配当計算
   ・罫線（大路・大眼仔）の計算

   画面の描画は ui.js、全体の進行は main.js が担当する。
   こう分けておくと、ルールのテストだけを独立して回せる。
============================================================ */

/* ------------------------------------------------------------
   定数
------------------------------------------------------------ */
const SUITS = ['s', 'h', 'd', 'c'];                    // スペード・ハート・ダイヤ・クラブ
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const PAYOUT = {
    player: 1,          // プレイヤー 1:1
    banker: 1,          // バンカー 1:1（コミッションは別途）
    tie: 8,             // タイ 8:1
    pPair: 11,          // ペア 11:1
    bPair: 11
};

const COMMISSION_RATE = 0.05;     // コミッションあり：バンカー勝ちから5%
const NO_COMM_SIX_RATE = 0.5;     // コミッションなし：バンカーが6で勝つと半額

/* ------------------------------------------------------------
   Shoe — 8デッキのシューを管理する
------------------------------------------------------------ */
class Shoe {
    constructor(deckCount = 8) {
        this.deckCount = deckCount;
        this.reset();
    }

    /** シューを組み直して、カットカードを入れる */
    reset() {
        this.cards = [];
        for (let d = 0; d < this.deckCount; d++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    this.cards.push({ suit, rank, value: this.rankToValue(rank) });
                }
            }
        }
        this.shuffle();

        // カットカードは残り14〜20枚のあたり。この枚数を切ったらそのシューは終了
        this.cutPosition = 14 + Math.floor(Math.random() * 7);
        this.finished = false;

        // バーンカード：1枚めくって、その数だけ捨てる（本物のカジノと同じ手順）
        const burn = this.cards.pop();
        const burnCount = burn.value === 0 ? 10 : burn.value;
        this.burned = [burn];
        for (let i = 0; i < burnCount; i++) {
            this.burned.push(this.cards.pop());
        }
    }

    /** Fisher–Yates シャッフル。偏りが出ない正しい手順 */
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    /** バカラのカード価値：A=1、2〜9=そのまま、10/J/Q/K=0 */
    rankToValue(rank) {
        if (rank === 'A') return 1;
        if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
        return Number(rank);
    }

    draw() {
        return this.cards.pop();
    }

    get remaining() {
        return this.cards.length;
    }

    /** カットカードを切ったかどうか。切ったらそのゲームを最後にする */
    get needsShuffle() {
        return this.cards.length <= this.cutPosition;
    }
}

/* ------------------------------------------------------------
   手札の計算
------------------------------------------------------------ */

/** 合計の下1桁がそのまま点数になる */
function handTotal(cards) {
    return cards.reduce((sum, c) => sum + c.value, 0) % 10;
}

/** 最初の2枚が同じランクならペア */
function isPair(cards) {
    return cards.length >= 2 && cards[0].rank === cards[1].rank;
}

/* ------------------------------------------------------------
   サードカード・ルール — バカラで唯一ややこしいところ

   プレイヤー：
     合計 0〜5 → 引く / 6〜7 → スタンド
   バンカー（プレイヤーが引かなかった場合）：
     合計 0〜5 → 引く / 6〜7 → スタンド
   バンカー（プレイヤーが引いた場合）：プレイヤーの3枚目の数で変わる
     0〜2 → 必ず引く
     3    → プレイヤーの3枚目が 8 以外なら引く
     4    → 2〜7 なら引く
     5    → 4〜7 なら引く
     6    → 6〜7 なら引く
     7    → 引かない
   どちらかが 8 か 9（ナチュラル）なら、その時点で終了
------------------------------------------------------------ */

function playerDraws(playerTotal) {
    return playerTotal <= 5;
}

function bankerDraws(bankerTotal, playerThirdValue) {
    // プレイヤーが3枚目を引かなかった場合は、プレイヤーと同じ基準
    if (playerThirdValue === null) {
        return bankerTotal <= 5;
    }

    switch (bankerTotal) {
        case 0:
        case 1:
        case 2:
            return true;
        case 3:
            return playerThirdValue !== 8;
        case 4:
            return playerThirdValue >= 2 && playerThirdValue <= 7;
        case 5:
            return playerThirdValue >= 4 && playerThirdValue <= 7;
        case 6:
            return playerThirdValue >= 6 && playerThirdValue <= 7;
        default:
            return false;       // 7 はスタンド、8・9 はナチュラルなのでここに来ない
    }
}

/* ------------------------------------------------------------
   1ゲーム分を進める

   返すのは「どういう順番で何が起きたか」の記録。
   画面側はこの記録を順に再生するだけでよい。
------------------------------------------------------------ */
function playRound(shoe) {
    const player = [shoe.draw(), shoe.draw()];
    const banker = [shoe.draw(), shoe.draw()];

    const steps = [
        { type: 'deal', side: 'player', card: player[0] },
        { type: 'deal', side: 'banker', card: banker[0] },
        { type: 'deal', side: 'player', card: player[1] },
        { type: 'deal', side: 'banker', card: banker[1] }
    ];

    let pTotal = handTotal(player);
    let bTotal = handTotal(banker);
    const natural = pTotal >= 8 || bTotal >= 8;

    let playerThirdValue = null;

    if (!natural) {
        if (playerDraws(pTotal)) {
            const card = shoe.draw();
            player.push(card);
            playerThirdValue = card.value;
            steps.push({ type: 'deal', side: 'player', card });
            pTotal = handTotal(player);
        }

        if (bankerDraws(bTotal, playerThirdValue)) {
            const card = shoe.draw();
            banker.push(card);
            steps.push({ type: 'deal', side: 'banker', card });
            bTotal = handTotal(banker);
        }
    }

    let outcome;
    if (pTotal > bTotal) outcome = 'player';
    else if (bTotal > pTotal) outcome = 'banker';
    else outcome = 'tie';

    return {
        player, banker,
        playerTotal: pTotal,
        bankerTotal: bTotal,
        outcome,
        natural,
        playerPair: isPair(player),
        bankerPair: isPair(banker),
        steps
    };
}

/* ------------------------------------------------------------
   配当の計算

   bets      : { player, banker, tie, pPair, bPair } 各ベット額
   result    : playRound の戻り値
   commission: true ならコミッションあり、false ならノーコミッション

   returns   : { payout, net, detail[] }
     payout … 戻ってくる総額（元金を含む）
     net    … 収支（プラスなら勝ち分）
------------------------------------------------------------ */
function settle(bets, result, commission) {
    const detail = [];
    let payout = 0;
    const staked = Object.values(bets).reduce((a, b) => a + b, 0);

    // --- メインベット ---
    if (result.outcome === 'tie') {
        // タイのときは、プレイヤー・バンカーのベットは返却（プッシュ）
        if (bets.player > 0) {
            payout += bets.player;
            detail.push({ name: 'PLAYER', text: 'プッシュ', amount: 0 });
        }
        if (bets.banker > 0) {
            payout += bets.banker;
            detail.push({ name: 'BANKER', text: 'プッシュ', amount: 0 });
        }
        if (bets.tie > 0) {
            const win = bets.tie * PAYOUT.tie;
            payout += bets.tie + win;
            detail.push({ name: 'TIE', text: `+${win.toLocaleString()}`, amount: win });
        }
    } else {
        if (bets.tie > 0) {
            detail.push({ name: 'TIE', text: `-${bets.tie.toLocaleString()}`, amount: -bets.tie });
        }

        if (result.outcome === 'player') {
            if (bets.player > 0) {
                const win = bets.player * PAYOUT.player;
                payout += bets.player + win;
                detail.push({ name: 'PLAYER', text: `+${win.toLocaleString()}`, amount: win });
            }
            if (bets.banker > 0) {
                detail.push({ name: 'BANKER', text: `-${bets.banker.toLocaleString()}`, amount: -bets.banker });
            }
        } else {
            if (bets.banker > 0) {
                let win = bets.banker * PAYOUT.banker;

                if (commission) {
                    // コミッションあり：勝ち分から5%
                    const fee = Math.floor(win * COMMISSION_RATE);
                    win -= fee;
                    payout += bets.banker + win;
                    detail.push({
                        name: 'BANKER',
                        text: `+${win.toLocaleString()}（コミッション -${fee.toLocaleString()}）`,
                        amount: win
                    });
                } else if (result.bankerTotal === 6) {
                    // ノーコミッション：バンカーが6で勝つと配当は半額
                    win = Math.floor(win * NO_COMM_SIX_RATE);
                    payout += bets.banker + win;
                    detail.push({
                        name: 'BANKER',
                        text: `+${win.toLocaleString()}（6勝ちのため半額）`,
                        amount: win
                    });
                } else {
                    payout += bets.banker + win;
                    detail.push({ name: 'BANKER', text: `+${win.toLocaleString()}`, amount: win });
                }
            }
            if (bets.player > 0) {
                detail.push({ name: 'PLAYER', text: `-${bets.player.toLocaleString()}`, amount: -bets.player });
            }
        }
    }

    // --- サイドベット（ペア） ---
    if (bets.pPair > 0) {
        if (result.playerPair) {
            const win = bets.pPair * PAYOUT.pPair;
            payout += bets.pPair + win;
            detail.push({ name: 'P PAIR', text: `+${win.toLocaleString()}`, amount: win });
        } else {
            detail.push({ name: 'P PAIR', text: `-${bets.pPair.toLocaleString()}`, amount: -bets.pPair });
        }
    }
    if (bets.bPair > 0) {
        if (result.bankerPair) {
            const win = bets.bPair * PAYOUT.bPair;
            payout += bets.bPair + win;
            detail.push({ name: 'B PAIR', text: `+${win.toLocaleString()}`, amount: win });
        } else {
            detail.push({ name: 'B PAIR', text: `-${bets.bPair.toLocaleString()}`, amount: -bets.bPair });
        }
    }

    return { payout, net: payout - staked, detail };
}


/* ------------------------------------------------------------
   大路（ビッグロード）

   ・タイは独立した列を作らず、直前のマスに斜線として重ねる
   ・同じ結果が続くと縦に伸び、変わると次の列へ
   ・6行目まで埋まったら、その先は右へ折れる（ドラゴンテール）
------------------------------------------------------------ */
const ROAD_ROWS = 6;

function buildBigRoad(history) {
    const grid = [];                    // grid[col][row] … 画面に描くための配置
    const streaks = [];                 // 連勝の長さ。派生罫線はこちらを使う
    let col = 0, row = 0, lastOutcome = null;

    const put = (cell) => {
        if (!grid[col]) grid[col] = [];
        grid[col][row] = cell;
    };

    for (const h of history) {
        if (h.outcome === 'tie') {
            // 直前のマスにタイ線を足す。まだ1つもなければ専用のマスを置く
            if (lastOutcome === null) {
                put({ outcome: 'tie', ties: 1, pPair: h.playerPair, bPair: h.bankerPair });
                lastOutcome = 'tie';
            } else {
                const cell = grid[col][row];
                if (cell) cell.ties = (cell.ties || 0) + 1;
            }
            continue;
        }

        if (lastOutcome === null || lastOutcome === 'tie') {
            // 最初の有効な結果
            put({ outcome: h.outcome, ties: 0, pPair: h.playerPair, bPair: h.bankerPair });
            streaks.push(1);
        } else if (h.outcome === lastOutcome) {
            // 同じ結果 → 下に伸ばす。ただし6行目まで、かつ下が空いているとき
            if (row + 1 < ROAD_ROWS && !(grid[col] && grid[col][row + 1])) {
                row++;
            } else {
                // 下が詰まっている → 右へ折れる（ドラゴンテール）
                col++;
                while (grid[col] && grid[col][row]) col++;
            }
            put({ outcome: h.outcome, ties: 0, pPair: h.playerPair, bPair: h.bankerPair });
            streaks[streaks.length - 1]++;      // 見た目は折れても、連勝としては同じ列
        } else {
            // 結果が変わった → 次の列の1行目から
            col = grid.length;
            row = 0;
            put({ outcome: h.outcome, ties: 0, pPair: h.playerPair, bPair: h.bankerPair });
            streaks.push(1);
        }

        lastOutcome = h.outcome;
    }

    grid.streaks = streaks;             // 派生罫線用に添えておく
    return grid;
}

/* ------------------------------------------------------------
   派生罫線（大眼仔・小路・甲由路）

   大路の「形」が規則的かどうかを見る罫線。
   どれも判定の仕方は同じで、どれだけ左の列と比べるか（offset）だけが違う。
     大眼仔 … offset 1（大路の2列目2行目が起点）
     小路   … offset 2
     甲由路 … offset 3

   判定：大路に新しいマスが置かれるたびに、1つ印を打つ。

   ・そのマスが列の2つ目以降（＝同じ結果が続いた）のとき
       比べる列の長さを N、そのマスの行番号を r とすると
         N ≠ r → 赤（規則的）
         N = r → 青（不規則）

   ・そのマスが列の1つ目（＝結果が変わった）のとき
       手前の2列の長さを比べて、同じなら赤、違えば青
------------------------------------------------------------ */
function buildDerivedRoad(bigRoad, offset) {
    const streaks = bigRoad.streaks || [];
    const marks = [];
    const len = (c) => (c >= 0 && c < streaks.length ? streaks[c] : 0);

    for (let col = 0; col < streaks.length; col++) {
        for (let row = 0; row < streaks[col]; row++) {
            // 起点より前は印を打たない
            const started = col > offset || (col === offset && row >= 1);
            if (!started) continue;

            let red;
            if (row === 0) {
                // 列が変わった → 手前2列の長さを比べる
                const a = len(col - offset);
                const b = len(col - offset - 1);
                if (a === 0 || b === 0) continue;
                red = a === b;
            } else {
                // 列が伸びた → 比べる列の長さと、今の行番号を見る
                const n = len(col - offset);
                if (n === 0) continue;
                red = n !== row;
            }
            marks.push(red ? 'red' : 'blue');
        }
    }

    return marks;
}

/** 大眼仔：大路の2列目2行目を起点にする */
function buildBigEyeBoy(bigRoad) {
    return buildDerivedRoad(bigRoad, 1);
}

/** 小路 */
function buildSmallRoad(bigRoad) {
    return buildDerivedRoad(bigRoad, 2);
}

/** 甲由路（コックローチピッグ） */
function buildCockroachPig(bigRoad) {
    return buildDerivedRoad(bigRoad, 3);
}

/** 派生罫線を6行のグリッドに並べ直す */
function marksToGrid(marks, rows = ROAD_ROWS) {
    const grid = [];
    marks.forEach((m, i) => {
        const col = Math.floor(i / rows);
        const row = i % rows;
        if (!grid[col]) grid[col] = [];
        grid[col][row] = m;
    });
    return grid;
}

/* ------------------------------------------------------------
   統計
------------------------------------------------------------ */
function buildStats(history) {
    const s = { total: 0, player: 0, banker: 0, tie: 0, pPair: 0, bPair: 0 };
    for (const h of history) {
        s.total++;
        s[h.outcome]++;
        if (h.playerPair) s.pPair++;
        if (h.bankerPair) s.bPair++;
    }
    return s;
}