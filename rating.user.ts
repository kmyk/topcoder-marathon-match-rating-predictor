// ==UserScript==
// @name         TopCoder Marathon Match Rating Predictor
// @namespace    https://github.com/kmyk
// @version      1.3
// @description  predict rating changes of TopCoder Marathon Match
// @author       Kimiyuki Onaka
// @include      https://community.topcoder.com/longcontest/?*module=ViewStanding*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jstat/1.7.1/jstat.min.js
// ==/UserScript==

// jStat v1.7.1 https://github.com/jstat/jstat http://jstat.github.io/
declare const jStat;
const erf = jStat.erf as ((number) => number);
function normSInv(p: number) {
    return jStat.normal.inv(p, 0, 1);
}

function getStandings(): object {
    const table = document.getElementsByClassName('statTable')[0];  // assume uniqueness
    const rows = table.getElementsByTagName('tr');
    let standings = [];
    for (let y = 2; y < rows.length; ++ y) {
        const cols = rows[y].getElementsByTagName('td');
        const data = {
            'handle': cols[0].textContent.trim().replace('*', ''),  // '*' is added when they are in the queue
            'score': parseFloat(cols[1].textContent),  // can be NaN
            'rank': cols[2].textContent.trim() ? parseInt(cols[2].textContent) : Infinity,
            'lastSubmissionDate': cols[3].textContent.trim(),
            'language': cols[4].textContent.trim(),
            'exampleTests': parseInt(cols[5].textContent),  // can be NaN
            'submissions': parseInt(cols[6].textContent),  // can be NaN
            'raw': rows[y],
        };
        standings.push(data);
    }
    return {
        'title': rows[0],
        'header': rows[1],
        'rows': standings,
    };
}

function getMemberStats(handle: string): Promise<object> {
    return new Promise((resolve: (object) => void, reject: (any) => void) => {
        const xhr = new XMLHttpRequest();
        const url = 'https://api.topcoder.com/v3/members/' + handle + '/stats';
        xhr.open('GET', url);
        xhr.onload = function () {
            resolve(JSON.parse(this.response));
        };
        xhr.send();
    });
}

function sleep(sec: number): Promise<null> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(null);
        }, sec);
    })
}

/**
 * @note slow, promises are used to make faster
 */
async function fetchStats(rows: object[]) {
    let promises = [];
    const connection = 3;
    for (let i = 0; i < Math.min(rows.length, connection); ++ i) {
        promises.push(getMemberStats(rows[i]['handle']));
    }
    for (let i = 0; i < rows.length; ++ i) {
        const stats = await promises[i];
        rows[i]['stats'] = stats;
        console.log(stats);
        await sleep(0.2);
        if (i + connection < rows.length) {
            promises.push(getMemberStats(rows[i + connection]['handle']));
        }

        // add a cell as a progress bar
        let rank = { 'competitions': 0 } as any;
        try {
            rank = stats['result']['content']['DATA_SCIENCE']['MARATHON_MATCH']['rank'];
        } catch (e) {
            if (e instanceof TypeError) {
                // nop
            } else {
                throw e;
            }
        }
        const tag = document.createElement('td');
        tag.classList.add('statLt');
        tag.align = 'center';
        tag.textContent = rank['competitions'] == 0 ? '-' : rank['rating'].toString();
        rows[i]['raw'].appendChild(tag);
    }
}


/**
 * @see https://community.topcoder.com/longcontest/?module=Static&d1=support&d2=ratings
 */
function predictRatings(rows: object[]): void {
    // How Marathon Match ratings are calculated
    let coders = [];
    for (const coder of rows) {
        const stats = coder['stats'];
        const content = stats['result']['content'];
        if (typeof content != "string"
                && content
                && 'DATA_SCIENCE' in content
                && 'MARATHON_MATCH' in content['DATA_SCIENCE']
                && 'rank' in content['DATA_SCIENCE']['MARATHON_MATCH']
                && content['DATA_SCIENCE']['MARATHON_MATCH']['rank']['competitions'] != 0) {
            const rank = content['DATA_SCIENCE']['MARATHON_MATCH']['rank'];
            coder['rating'] = rank['rating'];
            coder['volatility'] = rank['volatility'];
            coder['competitions'] = rank['competitions'];
            coder['isNewMember'] = false;
            coders.push(coder);
        } else {
            coder['rating'] = null;
            coder['isNewMember'] = true;
            coder['predictedRating'] = null;
            coder['ratingDelta'] = null;
        }
    }

    // New ratings are calculated as follows:
    let sumRating = 0;
    for (const coder of coders) {
        sumRating += coder['rating'];
    }
    const aveRating = sumRating / coders.length;

    // The competition factor is calculated:
    let sqSumVolatility = 0;
    let sqSumAveDiffRating = 0;
    for (const coder of coders) {
        sqSumVolatility += Math.pow(coder['volatility'], 2);
        sqSumAveDiffRating += Math.pow(coder['rating'] - aveRating, 2);
    }
    const competitionFactor = Math.sqrt(sqSumVolatility / coders.length + sqSumAveDiffRating / (coders.length - 1));

    // Win Probability Estimation Algorithm:
    const winProbability = (a: object, b: object): number => {
        const num = a['rating'] - b['rating'];
        const den = Math.sqrt(2 * (Math.pow(a['volatility'], 2) + Math.pow(b['volatility'], 2)));
        return 0.5 * (erf(num / den) + 1);
    };

    // The expected performance of the coder is calculated:
    for (const coder of coders) {
        let sumWinProb = 0;
        for (const other of coders) {
            sumWinProb += winProbability(other, coder);
        }
        coder['expectedRank'] = 0.5 + sumWinProb;
        coder['expectedPerformance'] = - normSInv((coder['expectedRank'] - 0.5) / coders.length);
    }

    // The performed as rating of the coder is calculated:
    for (let i = 0; i < coders.length; ++ i) {
        const coder = coders[i];
        let l = i; while (l - 1 >= 0 && coders[l]['rank'] == coder['rank']) -- l;
        let r = i + 1; while (r < coders.length && coders[r]['rank'] == coder['rank']) ++ r;
        const rank = (l + r - 1) / 2 + 1;
        coder['actualRank'] = rank;
        coder['performance'] = - normSInv((rank - 0.5) / coders.length);
    }

    // The actual performance of each coder is calculated:
    for (const coder of coders) {
        coder['perfAs'] = coder['rating'] + competitionFactor * (coder['performance'] - coder['expectedPerformance']);
    }

    // The weight of the competition for the coder is calculated:
    for (const coder of coders) {
        coder['weight'] = 1 / (1 - (0.42 / coder['competitions'] + 0.18)) - 1;
        if (2000 <= coder['rating'] && coder['rating'] <= 2500) {
            coder['weight'] *= 0.9;
        } else if (2500 < coder['rating']) {
            coder['weight'] *= 0.8;
        }
    }

    // A cap is calculated:
    for (const coder of coders) {
        coder['cap'] = 150 + 1500 / (coder['competitions'] + 2);
    }

    // The new rating of the coder is calculated:
    for (const coder of coders) {
        const num = coder['rating'] + coder['weight'] * coder['perfAs'];
        const den = 1 + coder['weight'];
        const cap = coder['rating'] + coder['cap'];
        coder['predictedRating'] = Math.min(cap, num / den);
        coder['ratingDelta'] = coder['predictedRating'] - coder['rating'];
    }

    // The new volatility of the coder is calculated:
    for (const coder of coders) {
        // omitted
    }

    // log
    console.log({
        'aveRating': aveRating,
        'competitionFactor': competitionFactor,
    });
    for (const coder of coders) {
        console.log(coder);
    }
}

function main(): void {
    const standings = getStandings();

    // update the header
    standings['title'].getElementsByTagName('td')[0].colSpan += 3;
    for (const name of [ 'Current Rating', 'Predicted Rating', 'Rating Delta' ]) {
        const tag = document.createElement('td');
        tag.classList.add('tableHeader');
        tag.width = '20%';
        tag.align = 'center';
        tag.noWrap = true;
        tag.textContent = name;
        standings['header'].appendChild(tag);
    }

    // update the data
    fetchStats(standings['rows']).then(() => {
        predictRatings(standings['rows']);
        for (const row of standings['rows']) {
            for (const name of [ 'predictedRating', 'ratingDelta' ]) {
                const tag = document.createElement('td');
                tag.classList.add('statLt');
                tag.align = 'center';
                tag.textContent = (typeof row[name] == 'number' ? row[name].toFixed(2) : '-');
                row['raw'].appendChild(tag);
            }
        }
    });
}

main();
