// ==UserScript==
// @name         CERN GitLab Ready for review button
// @namespace    https://github.com/7PH
// @version      1.0.0
// @description  Adds a button to merge requests that adds (or removes) the epctoolsreview bot as a reviewer
// @author       lorossi (https://github.com/lorossi)
// @match        https://gitlab.cern.ch/epc/ccs/fgc/fgc/-/merge_requests/*
// @match        https://gitlab.cern.ch/epc/ccs/fgc/fgc-next/-/merge_requests/*
// @match        https://gitlab.cern.ch/epc/ccs/tools/fgc-web/-/merge_requests/*
// @match        https://gitlab.cern.ch/epc/ccs/tools/kt-web/-/merge_requests/*
// @match        https://gitlab.cern.ch/epc/ccs/data/fgc-prod/-/merge_requests/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @run-at       document-idle
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/gitlab.cern.ch/gitlab-ready-for-review-button.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/gitlab.cern.ch/gitlab-ready-for-review-button.user.js
// ==/UserScript==

(() => {
  "use strict";

  const BOT_USERNAME = "epctoolsreview";
  const BUTTON_ID = "ccs-ready-for-review";

  const QUERY = `
    query ($path: ID!, $iid: String!) {
      project(fullPath: $path) {
        mergeRequest(iid: $iid) {
          state
          reviewers { nodes { username } }
        }
      }
    }`;

  const MUTATION = `
    mutation ($path: ID!, $iid: String!, $users: [String!]!, $mode: MutationOperationMode!) {
      mergeRequestSetReviewers(
        input: { projectPath: $path, iid: $iid, reviewerUsernames: $users, operationMode: $mode }
      ) {
        errors
      }
    }`;

  const match = location.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)(?:\/|$)/);
  if (!match) return;
  const [, projectPath, iid] = match;

  // "loading" until the first lookup returns, then "ready" (bot is a reviewer),
  // "not-ready" or "closed". Kept here so header re-renders keep the state.
  let state = "loading";
  let busy = false;

  async function graphql(query, variables) {
    const csrf = document.querySelector("meta[name=csrf-token]")?.content ?? "";
    const response = await fetch("/api/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
    return body.data;
  }

  function render(button) {
    const ready = state === "ready";
    button.hidden = state === "closed";
    button.disabled = busy || state === "loading";
    button.classList.toggle("disabled", button.disabled);
    button.classList.toggle("btn-confirm", !ready);
    button.classList.toggle("btn-default", ready);
    button.querySelector(".gl-button-text").textContent = busy
      ? "Updating…"
      : ready ? "Unready" : "Ready for review";
    button.title = ready
      ? `Remove ${BOT_USERNAME} from the reviewers`
      : `Add ${BOT_USERNAME} as reviewer`;
  }

  async function toggle(button) {
    const mode = state === "ready" ? "REMOVE" : "APPEND";
    busy = true;
    render(button);
    try {
      const data = await graphql(MUTATION, {
        path: projectPath, iid, users: [BOT_USERNAME], mode,
      });
      const errors = data.mergeRequestSetReviewers.errors;
      if (errors.length) throw new Error(errors.join("; "));
      // The sidebar does not pick up the reviewer change by itself.
      location.reload();
    } catch (error) {
      console.error("[ready-for-review]", error);
      busy = false;
      render(button);
      alert(`Could not update ${BOT_USERNAME} as reviewer:\n${error.message}`);
    }
  }

  function inject() {
    if (document.getElementById(BUTTON_ID)) return;
    const actions = document.querySelector(".detail-page-header .js-issuable-actions");
    if (!actions) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "gl-button btn btn-md gl-self-start";
    button.innerHTML = '<span class="gl-button-text"></span>';
    button.addEventListener("click", () => toggle(button));
    render(button);
    // Right of the "Code" dropdown and the three-dots menu.
    const mrActions = actions.querySelector(":scope > [data-testid='merge-request-actions']");
    if (mrActions) mrActions.after(button);
    else actions.append(button);
  }

  async function init() {
    inject();
    try {
      const mr = (await graphql(QUERY, { path: projectPath, iid })).project?.mergeRequest;
      if (!mr || mr.state !== "opened") state = "closed";
      else if (mr.reviewers.nodes.some((r) => r.username === BOT_USERNAME)) state = "ready";
      else state = "not-ready";
    } catch (error) {
      console.error("[ready-for-review]", error);
      state = "not-ready";
    }
    const button = document.getElementById(BUTTON_ID);
    if (button) render(button);
  }

  // GitLab re-renders the header (Vue), which can drop the button.
  new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  init();
})();
