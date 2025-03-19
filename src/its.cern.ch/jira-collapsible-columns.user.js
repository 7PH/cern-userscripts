// ==UserScript==
// @name         CERN JIRA Add collapsible columns in Kanban boards
// @namespace    https://github.com/7PH
// @version      0.0.1
// @description  Add collapsible columns in JIRA Kanban boards (click on a column header to collapse it)
// @author       7PH (https://github.com/7PH)
// @match        https://its.cern.ch/jira/secure/RapidBoard.jspa?rapidView=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/its.cern.ch/jira-collapsible-columns.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/its.cern.ch/jira-collapsible-columns.user.js
// ==/UserScript==
// 

(function() {
    'use strict';

    const RESET_BUTTON_CLASS = 'userscript-column-reset-button';

    const SELECTORS = {
        sprintHeader: '#ghx-modes-tools',
        sprintColumnHeaders: '.ghx-column-headers > li',
        sprintColumnLists: '.ghx-columns',
        sprintColumns: '.ghx-column.ui-sortable',
        resetButton: `.${RESET_BUTTON_CLASS}`,
    };

    const SELECTOR_POLLING_DELAY_MS = 100;

    async function sleepFor(durationMs) {
        return new Promise(resolve => setTimeout(resolve, durationMs));
    }

    async function waitForSelector(selector, onlyOne) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
            await sleepFor(SELECTOR_POLLING_DELAY_MS);
            return waitForSelector(selector, onlyOne);
        }
        if (onlyOne) {
            return Array.from(elements)[0];
        } else {
            return Array.from(elements);
        }
    }

    async function getColumnNodes() {
        const headerNodes = await waitForSelector(SELECTORS.sprintColumnHeaders);
        const columnListNodes = await waitForSelector(SELECTORS.sprintColumnLists);
        const count = headerNodes.length;
        const columns = [];
        for (const columnList of columnListNodes) {
            columns.push(columnList.querySelectorAll(SELECTORS.sprintColumns));
        }
        const nodes = {
            header: headerNodes,
            columns,
            count,
        };
        return nodes;
    }

    async function showResetButton() {
        const container = await waitForSelector(SELECTORS.sprintHeader, true);
        if (container) {
            if (! container.querySelector(SELECTORS.resetButton)) {
                const button = document.createElement('button');
                button.innerHTML = 'Show all columns';
                button.className = `${RESET_BUTTON_CLASS} aui-button`;
                button.onclick = resetColumns;
                container.prepend(button);
            }
        }
    }

    async function resetColumns() {
        const nodes = await getColumnNodes();

        for (let i = 0; i < nodes.count; ++ i) {
            const header = nodes.header[i];

            if (header.dataset.collapsed === '1') {
                await toggleColumn(nodes, i);
            }
        }
    }

    async function toggleColumn(nodes, index) {
        const header = nodes.header[index];
        const columns = nodes.columns.map(colList => colList[index]);

        if (header.dataset.collapsed !== '1') {
            header.dataset.collapsed = '1';
            header.style.display = 'none';
            for (const column of columns) {
                column.style.display = 'none';
            }
            await showResetButton();
        } else {
            header.dataset.collapsed = '0';
            header.style.display = '';
            for (const column of columns) {
                column.style.display = '';
            }
        }
    }

    async function applyFix() {
        const nodes = await getColumnNodes();

        for (let i = 0; i < nodes.count; ++ i) {
            const header = nodes.header[i];

            header.style.cursor = 'pointer';
            header.onclick = () => {
                toggleColumn(nodes, i);
            };
        }
    }

    applyFix();

    const observer = new MutationObserver(applyFix);
    observer.observe(document.body, { childList: true, subtree: true });
})();