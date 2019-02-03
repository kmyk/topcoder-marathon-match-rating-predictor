"use strict";
// ==UserScript==
// @name         TopCoder Marathon Match Rating Predictor
// @namespace    https://github.com/kmyk
// @version      1.8
// @description  predict rating changes of TopCoder Marathon Match
// @author       Kimiyuki Onaka
// @match        *://community.topcoder.com/longcontest/?*module=ViewStanding*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jstat/1.7.1/jstat.min.js
// ==/UserScript==
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const erf = jStat.erf;
function normSInv(p) {
    return jStat.normal.inv(p, 0, 1);
}
function readCacheOnLocalStorage(key, expires) {
    const cached = localStorage.getItem(key);
    if (cached == null)
        return null;
    const data = JSON.parse(cached);
    if (data['timestamp'] + expires < Date.now()) {
        localStorage.removeItem(key); // expired
        return null;
    }
    else {
        return data['value'];
    }
}
function writeCacheOnLocalStorage(key, value) {
    localStorage.setItem(key, JSON.stringify({ 'timestamp': Date.now(), 'value': value }));
}
const localStorangePrefix = 'rating-predictor/';
;
function parseStatTableRow(row) {
    const cols = row.getElementsByTagName('td');
    const text = [];
    for (let x = 0; x < 7; ++x) {
        text[x] = cols[x].textContent.trim();
    }
    return {
        'handle': text[0].replace('*', ''),
        'hasStar': text[0].charAt(0) == '*',
        'score': text[1] ? parseFloat(text[1]) : null,
        'rank': text[2] ? parseInt(text[2]) : Infinity,
        'lastSubmissionTime': text[3] ? text[3] : null,
        'language': text[4] ? text[4] : null,
        'exampleTests': parseInt(text[5]),
        'submissions': parseInt(text[6]),
    };
}
function parseStatTable(statTable) {
    const data = [];
    const rows = statTable.getElementsByTagName('tr');
    for (let y = 2; y < rows.length; ++y) {
        data.push(parseStatTableRow(rows[y]));
    }
    return data;
}
function getStatTableDom(doc) {
    return doc.getElementsByClassName('statTable')[0];
}
function getStatTable(doc) {
    return parseStatTable(getStatTableDom(doc));
}
function addStatTableColumn(statTable, name, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = statTable.getElementsByTagName('tr');
        // extends the "Standings" box
        rows[0].getElementsByTagName('td')[0].colSpan += 1;
        // add a header cell
        const tag = document.createElement('td');
        tag.classList.add('tableHeader');
        tag.width = '20%';
        tag.align = 'center';
        tag.noWrap = true;
        tag.textContent = name;
        rows[1].appendChild(tag);
        // add empty cells
        const tags = [];
        for (let y = 2; y < rows.length; ++y) {
            const tag = document.createElement('td');
            tag.classList.add('statLt');
            tag.align = 'center';
            rows[y].appendChild(tag);
            tags.push(tag);
        }
        // fill cells with values (delayed to avoid possible conflictions with other userscripts)
        for (let y = 2; y < rows.length; ++y) {
            tags[y - 2].textContent = yield callback(parseStatTableRow(rows[y])); // this should be serialized to reduce the load of the API server
        }
    });
}
function sleep(sec) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(null);
        }, sec);
    });
}
/**
 * @param expires in msec
 */
function requestWithCachingLocalStorage(url, key, expires) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const cached = readCacheOnLocalStorage(key, expires);
            if (cached != null) {
                resolve(cached);
            }
            else {
                console.log('GET ' + url);
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url);
                xhr.onload = function () {
                    writeCacheOnLocalStorage(key, this.response);
                    resolve(this.response);
                };
                xhr.send();
            }
        });
    });
}
;
/**
 * @return MemberStats, or null for new members
 */
function parseMemberStats(stats) {
    const content = stats['result']['content'];
    if (typeof content != "string"
        && content
        && 'DATA_SCIENCE' in content
        && 'MARATHON_MATCH' in content['DATA_SCIENCE']
        && 'rank' in content['DATA_SCIENCE']['MARATHON_MATCH']
        && content['DATA_SCIENCE']['MARATHON_MATCH']['rank'] != null
        && content['DATA_SCIENCE']['MARATHON_MATCH']['rank']['competitions'] != 0) {
        const rank = content['DATA_SCIENCE']['MARATHON_MATCH']['rank'];
        return {
            'rating': rank['rating'],
            'volatility': rank['volatility'],
            'competitions': rank['competitions'],
        };
    }
    else {
        return null;
    }
}
function requestMemberStats(handle) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = 'https://api.topcoder.com/v3/members/' + handle + '/stats';
        const expires = 24 * 60 * 60 * 1000; // 1 day
        const response = yield requestWithCachingLocalStorage(url, localStorangePrefix + 'url/' + url, expires);
        return parseMemberStats(JSON.parse(response));
    });
}
function requestRating(handle) {
    return __awaiter(this, void 0, void 0, function* () {
        const value = yield requestMemberStats(handle);
        return value != null ? value.rating : null;
    });
}
function getCurrentPage() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sc') != null && params.get('sc') != '')
        return null; // sort column
    if (params.get('nr') != null && params.get('nr') != '100')
        return null; // number
    const sr = params.get('sr');
    const start = sr == null ? 1 : parseInt(sr);
    if (start % 100 != 1)
        return null;
    return (start - 1) / 100;
}
function getViewStandingsUrlPage(page) {
    const url = 'https://community.topcoder.com/longcontest/';
    const params = new URLSearchParams(window.location.search);
    params.set('module', 'ViewStandings');
    params.set('rd', (new URLSearchParams(window.location.search)).get('rd'));
    if (page != 0) {
        params.set('nr', '100'); // number
        params.set('sr', (1 + page * 100).toString()); // start
    }
    return url + '?' + params.toString();
}
function requestStatTablePage(page) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = getViewStandingsUrlPage(page);
        const key = localStorangePrefix + 'url/' + url;
        if (page == getCurrentPage()) {
            writeCacheOnLocalStorage(key, document.documentElement.innerHTML);
            return getStatTable(document);
        }
        else {
            const expires = 30 * 60 * 1000; // 30 minutes
            const response = yield requestWithCachingLocalStorage(url, key, expires);
            const parser = new DOMParser();
            const doc = parser.parseFromString(response, 'text/html');
            return getStatTable(doc);
        }
    });
}
function requestFullStatTable() {
    return __awaiter(this, void 0, void 0, function* () {
        // there is only one page (caching is unnecessary)
        let rows = getStatTable(document);
        if (rows.length <= 99)
            return rows;
        // there are two or more pages
        rows = [];
        for (let page = 0;; ++page) {
            const newRows = yield requestStatTablePage(page);
            if (newRows.length == 0)
                break;
            rows = rows.concat(newRows);
        }
        return rows;
    });
}
/**
 * @return MemberStats[] which has the same length to the argument
 */
function requestAllMemberStats(rows) {
    return __awaiter(this, void 0, void 0, function* () {
        let stats = [];
        for (const row of rows) {
            stats.push(yield requestMemberStats(row.handle)); // this should be serialized to reduce the load of the API server
        }
        return stats;
    });
}
;
/**
 * @see https://community.topcoder.com/longcontest/?module=Static&d1=support&d2=ratings
 * @return the list of predicted ratings which has the same length to the argument
 */
function predictRatings(rows, stats) {
    // How Marathon Match ratings are calculated
    let coders = [];
    for (let i = 0; i < rows.length; ++i) {
        const stats_i = stats[i];
        if (stats_i == null)
            continue;
        const coder = {
            handle: rows[i].handle,
            rank: rows[i].rank,
            rating: stats_i.rating,
            volatility: stats_i.volatility,
            competitions: stats_i.competitions,
        };
        coders.push(coder);
    }
    // sort for the cases when rows are not sorted by Rank
    coders.sort((a, b) => {
        return a.rank - b.rank;
    });
    // New ratings are calculated as follows:
    let sumRating = 0;
    for (const coder of coders) {
        sumRating += coder.rating;
    }
    const aveRating = sumRating / coders.length;
    // The competition factor is calculated:
    let sqSumVolatility = 0;
    let sqSumAveDiffRating = 0;
    for (const coder of coders) {
        sqSumVolatility += Math.pow(coder.volatility, 2);
        sqSumAveDiffRating += Math.pow(coder.rating - aveRating, 2);
    }
    const competitionFactor = Math.sqrt(sqSumVolatility / coders.length + sqSumAveDiffRating / (coders.length - 1));
    // Win Probability Estimation Algorithm:
    const winProbability = (a, b) => {
        const num = a.rating - b.rating;
        const den = Math.sqrt(2 * (Math.pow(a.volatility, 2) + Math.pow(b.volatility, 2)));
        return 0.5 * (erf(num / den) + 1);
    };
    // The expected performance of the coder is calculated:
    for (const coder of coders) {
        let sumWinProb = 0;
        for (const other of coders) {
            sumWinProb += winProbability(other, coder);
        }
        coder['expectedRank'] = 0.5 + sumWinProb;
        coder['expectedPerformance'] = -normSInv((coder['expectedRank'] - 0.5) / coders.length);
    }
    // The performed as rating of the coder is calculated:
    for (let i = 0; i < coders.length; ++i) {
        const coder = coders[i];
        let l = i;
        while (l - 1 >= 0 && coders[l].rank == coder.rank)
            --l;
        let r = i + 1;
        while (r < coders.length && coders[r].rank == coder.rank)
            ++r;
        const rank = (l + r - 1) / 2 + 1;
        coder['actualRank'] = rank;
        coder['actualPerformance'] = -normSInv((rank - 0.5) / coders.length);
    }
    // The actual actualPerformance of each coder is calculated:
    for (const coder of coders) {
        coder['perfAs'] = coder.rating + competitionFactor * (coder['actualPerformance'] - coder['expectedPerformance']);
    }
    // The weight of the competition for the coder is calculated:
    for (const coder of coders) {
        coder['weight'] = 1 / (1 - (0.42 / coder.competitions + 0.18)) - 1;
        if (2000 <= coder.rating && coder.rating <= 2500) {
            coder['weight'] *= 0.9;
        }
        else if (2500 < coder.rating) {
            coder['weight'] *= 0.8;
        }
    }
    // A cap is calculated:
    for (const coder of coders) {
        coder['cap'] = 150 + 1500 / (coder.competitions + 2);
    }
    // The new rating of the coder is calculated:
    for (const coder of coders) {
        const num = coder.rating + coder['weight'] * coder['perfAs'];
        const den = 1 + coder['weight'];
        const cap = coder.rating + coder['cap'];
        coder['predictedRating'] = Math.min(cap, num / den);
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
    // construct the dict
    const dict = {};
    for (const coder of coders) {
        dict[coder.handle] = coder['predictedRating'];
    }
    return dict;
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const statTable = getStatTableDom(document);
        yield addStatTableColumn(statTable, 'Current Rating', (row) => __awaiter(this, void 0, void 0, function* () {
            const a = yield requestRating(row.handle);
            return a == null ? '-' : a.toString();
        }));
        const rows = yield requestFullStatTable();
        const stats = yield requestAllMemberStats(rows);
        const predictedRating = predictRatings(rows, stats);
        yield addStatTableColumn(statTable, 'Predicted Rating', (row) => __awaiter(this, void 0, void 0, function* () {
            const b = predictedRating[row.handle];
            return b == undefined ? '-' : b.toFixed(2).toString();
        }));
        yield addStatTableColumn(statTable, 'Rating Delta', (row) => __awaiter(this, void 0, void 0, function* () {
            const a = yield requestRating(row.handle);
            const b = predictedRating[row.handle];
            return a == null || b == undefined ? '-' : (b - a).toFixed(2).toString();
        }));
    });
}
main();
