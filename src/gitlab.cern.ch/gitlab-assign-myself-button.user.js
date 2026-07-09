// ==UserScript==
// @name         CERN GitLab Assign myself to MR
// @namespace    https://github.com/7PH
// @version      0.0.1
// @description  Add "Assign myself" / "Review myself" buttons to merge request sidebars, working even when someone else is already assigned
// @author       7PH (https://github.com/7PH)
// @match        https://gitlab.cern.ch/epc/*/-/merge_requests/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/gitlab.cern.ch/gitlab-assign-myself-button.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/gitlab.cern.ch/gitlab-assign-myself-button.user.js
// ==/UserScript==

(function() {
    'use strict';

    // GitLab natively offers "assign yourself" only when the list is empty. These
    // buttons always append the current user, so they work even when someone else
    // is already assigned/reviewing.
    const WIDGETS = [
        {
            label: 'Assign myself',
            noun: 'Assignee',
            blockSelector: '[data-testid="assignee-block-container"]',
            anchorSelector: '[data-testid="edit-button"]',
            listSelector: '.issuable-assignees',
            itemSelector: null,
            mutation: 'mergeRequestSetAssignees',
            usernamesField: 'assigneeUsernames',
        },
        {
            label: 'Review myself',
            noun: 'Reviewer',
            blockSelector: '[data-testid="reviewers-block-container"]',
            anchorSelector: '.reviewers-dropdown',
            listSelector: null,
            itemSelector: '[data-testid="reviewer"]',
            mutation: 'mergeRequestSetReviewers',
            usernamesField: 'reviewerUsernames',
        },
    ];

    const BUTTON_CLASSES = 'gl-button btn-link btn-sm gl-ml-auto gl-mr-2 js-assign-myself';

    function currentUser() {
        const gon = window.gon;
        return {
            id: gon.current_user_id,
            username: gon.current_username,
            name: gon.current_user_fullname,
            avatar: gon.current_user_avatar_url,
        };
    }

    async function appendMyself(widget) {
        const path = document.location.pathname;
        const query = `mutation {
            ${widget.mutation}(input: {
                projectPath: "${path.match(/^\/(.+?)\/-\/merge_requests/)[1]}",
                iid: "${path.match(/merge_requests\/(\d+)/)[1]}",
                ${widget.usernamesField}: ["${currentUser().username}"],
                operationMode: APPEND
            }) { errors }
        }`;
        const response = await fetch('/api/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content,
            },
            body: JSON.stringify({ query }),
        });
        const result = await response.json();
        const errors = (result.errors || []).map(error => error.message)
            .concat((result.data && result.data[widget.mutation].errors) || []);
        if (errors.length > 0) {
            throw new Error(errors.join(', '));
        }
    }

    function avatarLink(user) {
        const link = document.createElement('a');
        link.href = `${document.location.origin}/${user.username}`;
        link.className = 'js-user-link gl-inline-block gl-mr-2';
        link.title = user.name;
        link.dataset.username = user.username;
        link.dataset.userId = user.id;
        const avatar = document.createElement('img');
        avatar.src = user.avatar;
        avatar.alt = user.name;
        avatar.className = 'gl-avatar gl-avatar-circle gl-avatar-s24';
        link.appendChild(avatar);
        return link;
    }

    const DROPDOWN = '.gl-new-dropdown-panel, .dropdown-menu-user, [data-testid="base-dropdown-menu"], [data-testid="dropdown-list-content"]';

    // GitLab keeps assignees/reviewers in its Apollo cache and won't re-render after
    // our out-of-band mutation, so optimistically reflect the change in the sidebar.
    function reflectInSidebar(widget, block, user) {
        // A displayed avatar is an <a>; ignore the hidden inputs and dropdown options
        // that also carry data-username.
        const displayed = [...block.querySelectorAll(`a[data-username="${user.username}"]`)]
            .some(link => !link.closest(DROPDOWN));
        if (displayed) {
            return; // Already shown, nothing to do (and don't double-count).
        }

        const placeholder = block.querySelector('[data-testid="none"], [data-testid="no-value"]');
        const list = (widget.listSelector && block.querySelector(widget.listSelector))
            || (widget.itemSelector && block.querySelector(widget.itemSelector)?.parentElement)
            || (placeholder && placeholder.parentElement);
        if (placeholder) {
            placeholder.remove();
        }
        if (list) {
            list.appendChild(avatarLink(user));
        }

        // Update the counter the way GitLab renders it: "0 Assignees", "Assignee" (1),
        // "2 Assignees", ... The count is in the bold header, not the dropdown.
        const header = block.querySelector('[class*="gl-font-bold"]');
        const counter = new RegExp(`(?:(\\d+)\\s+)?${widget.noun}s?`);
        const walker = header && document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
        for (let node = walker && walker.nextNode(); node; node = walker.nextNode()) {
            const match = node.nodeValue.match(counter);
            if (match) {
                const next = (match[1] === undefined ? 1 : Number(match[1])) + 1;
                node.nodeValue = node.nodeValue.replace(counter, next === 1 ? widget.noun : `${next} ${widget.noun}s`);
                break;
            }
        }
    }

    function createButton(widget) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON_CLASSES;
        button.textContent = widget.label;
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = '…';
            try {
                await appendMyself(widget);
                reflectInSidebar(widget, document.querySelector(widget.blockSelector), currentUser());
            } catch (error) {
                alert(`Could not ${widget.label.toLowerCase()}: ${error.message}`);
            } finally {
                button.textContent = widget.label;
                button.disabled = false;
            }
        });
        return button;
    }

    function injectButtons() {
        for (const widget of WIDGETS) {
            const anchor = document.querySelector(`${widget.blockSelector} ${widget.anchorSelector}`);
            if (!anchor || anchor.parentNode.querySelector('.js-assign-myself')) {
                continue;
            }
            anchor.parentNode.insertBefore(createButton(widget), anchor);
        }
    }

    // GitLab is a SPA and re-renders the sidebar, so keep the buttons in place.
    new MutationObserver(injectButtons).observe(document.body, { childList: true, subtree: true });
    injectButtons();
})();
