// ==UserScript==
// @name         CERN JIRA Move comment input near the latest comment
// @namespace    https://github.com/7PH
// @version      0.0.2
// @description  Moves the comment input next to the latest comment (top of the activity panel when showing newest first)
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

(() => {
    'use strict';

    const SORT_BUTTON_SELECTOR = '#sort-button';
    const ADD_COMMENT_SELECTOR = '#addcomment';
    const ISSUE_PANEL_WRAPPER_SELECTOR = '.issuePanelWrapper';
    const ISSUE_PANEL_CONTAINER_SELECTOR = '.issuePanelContainer';

    // Idempotent: brings the comment input to its desired place, and does nothing
    // if it's already there or if there's nothing to move. Safe to call any number
    // of times, which is what lets us simply re-run it whenever the UI changes.
    function fixCommentInput() {
        const sortButton = document.querySelector(SORT_BUTTON_SELECTOR);
        if (!sortButton) {
            return;
        }

        // Reload on sort toggle so the input is repositioned for the new order.
        if (!sortButton.dataset.fixCommentInputBound) {
            sortButton.dataset.fixCommentInputBound = 'true';
            sortButton.addEventListener('click', () => setTimeout(() => location.reload(), 100));
        }

        // `data-order` is the toggle's *target* order, so 'asc' means the comments
        // are currently shown newest first (latest comment on top). Only then does
        // moving the input to the top of the panel bring it near the latest comment.
        if (sortButton.getAttribute('data-order') !== 'asc') {
            return;
        }

        const addComment = document.querySelector(ADD_COMMENT_SELECTOR);
        const wrapper = document.querySelector(ISSUE_PANEL_WRAPPER_SELECTOR);
        const container = document.querySelector(ISSUE_PANEL_CONTAINER_SELECTOR);
        if (!addComment || !wrapper || !container) {
            return;
        }

        // Already in place.
        if (addComment.parentElement === wrapper && addComment.nextElementSibling === container) {
            return;
        }

        // Fix styling.
        addComment.style.borderTop = 'none';
        addComment.style.paddingTop = '0';
        if (addComment.firstElementChild) {
            addComment.firstElementChild.style.paddingLeft = '0';
        }

        // Move the comment input right above the comments list.
        wrapper.insertBefore(addComment, container);
    }

    // JIRA rebuilds the issue view on in-app navigation (e.g. the split-view issue
    // navigator) without a full page reload, so re-run the fix whenever the DOM
    // changes. Use a trailing debounce so we only act once the DOM has settled:
    // moving the input mid-rebuild lands it in a subtree JIRA then discards, which
    // would destroy the comment box entirely.
    let timer = null;
    const scheduleFix = () => {
        clearTimeout(timer);
        timer = setTimeout(fixCommentInput, 250);
    };

    new MutationObserver(scheduleFix).observe(document.documentElement, { childList: true, subtree: true });
    scheduleFix();
})();
