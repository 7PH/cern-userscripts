// ==UserScript==
// @name         CERN JIRA Fix
// @namespace    https://github.com/7PH
// @version      0.0.1
// @description  Ensure the comment input is where it's supposed to be
// @author       7PH (https://github.com/7PH)
// @match        https://its.cern.ch/jira/browse/*-*
// @match        https://its.cern.ch/jira/projects/*/issues/*-*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/its.cern.ch/jira-fix-comment-input.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/its.cern.ch/jira-fix-comment-input.user.js
// ==/UserScript==
// 

// Wait until an element matching the selector is found, or throw an error after a timeout.
const waitForSelector = async (selector, interval = 100, maxAttempts = 50) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
        const element = document.querySelector(selector);
        if (element) return element;
        await new Promise(resolve => setTimeout(resolve, interval));
        attempts++;
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
};

(() => {
    'use strict';
    const SORT_BUTTON_SELECTOR = '#sort-button';
    const ADD_COMMENT_SELECTOR = '#addcomment';
    const ISSUE_PANEL_WRAPPER_SELECTOR = '.issuePanelWrapper';
    const ISSUE_PANEL_CONTAINER_SELECTOR = '.issuePanelContainer';

    async function fix() {
        const sortButtonNode = await waitForSelector(SORT_BUTTON_SELECTOR);
        sortButtonNode.addEventListener('click', () => setTimeout(() => location.reload(), 100));
        if (sortButtonNode.getAttribute('data-order') === 'desc') {
            return;
        }

        const issuePanelWrapperNode = await waitForSelector(ISSUE_PANEL_WRAPPER_SELECTOR);
        const addCommentNode = await waitForSelector(ADD_COMMENT_SELECTOR);
        const issuePanelContainerNode = await waitForSelector(ISSUE_PANEL_CONTAINER_SELECTOR);

        // Mark the comment as "fixed" so we don't run this code again.
        addCommentNode.setAttribute('data-fixed', 'true');

        // Fix styling.
        addCommentNode.style.borderTop = 'none';
        addCommentNode.style.paddingTop = '0';
        addCommentNode.firstElementChild?.style && (addCommentNode.firstElementChild.style.paddingLeft = '0');

        // Reposition the comment area and ensure "Newest first" ordering.
        issuePanelWrapperNode.insertBefore(addCommentNode, issuePanelContainerNode);

        // Detect when issuePanelContainerNode is removed from teh DOM
        const observer = new MutationObserver(() => {
            if (!document.contains(issuePanelContainerNode)) {
                observer.disconnect();
                setTimeout(() => fix(), 500); // TODO: Find a better way to detect when the issue panel is removed.
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    fix();
})();
