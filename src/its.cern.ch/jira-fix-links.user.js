// ==UserScript==
// @name         Fix hyperlinks in JIRA sprint boards
// @namespace    https://github.com/7PH
// @version      0.0.1
// @description  Fixes hyperlinks in JIRA sprint boards.
// @author       7PH (https://github.com/7PH)
// @match        https://its.cern.ch/jira/secure/RapidBoard.jspa?rapidView=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/7PH/cern-userscripts/master/src/its.cern.ch/jira-fix-links.user.js
// @downloadURL  https://raw.githubusercontent.com/7PH/cern-userscripts/master/src/its.cern.ch/jira-fix-links.user.js
// ==/UserScript==

(async function() {
    'use strict';

    const SELECTORS = {
        issueBlock: '.js-issue',
        issueBlockTitle: '.js-issue a.js-key-link',
    };

    const SELECTOR_POLLING_DELAY_MS = 100;

    async function sleepFor(durationMs) {
        return new Promise(resolve => setTimeout(resolve, durationMs));
    }

    async function waitForSelector(selector) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
            await sleepFor(SELECTOR_POLLING_DELAY_MS);
            return waitForSelector(selector);
        }
        return elements;
    }

    function overrideClickEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        window.open(event.target.closest('a').href);
        return false;
    }

    async function applyFix() {
        const issueTitles = await waitForSelector(SELECTORS.issueBlockTitle);
        for (const issueTitle of issueTitles) {
            if (issueTitle.dataset.fixed) {
                // return;
            }
            issueTitle.addEventListener("click", overrideClickEvent);
            issueTitle.dataset.fixed = "true";
        }
    }

    applyFix();

    const observer = new MutationObserver(applyFix);
    observer.observe(document.body, { childList: true, subtree: true });
})();
