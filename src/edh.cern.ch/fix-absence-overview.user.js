// ==UserScript==
// @name         CERN EDH Fix Absence Overview
// @namespace    https://github.com/7PH
// @version      2025-03-05
// @description  Fixes issues with the AbsenceOverview page.
// @author       7PH (https://github.com/7PH)
// @match        https://edh.cern.ch/Document/Claims/AbsenceOverview
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/edh.cern.ch/fix-absence-overview.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/edh.cern.ch/fix-absence-overview.user.js
// ==/UserScript==

/**
 * - Show month labels in the table
 * - Adjust FROMDATE to the start of the week
 * - Trigger submission if no results are shown (never show an empty page)
 */

(function () {
    'use strict';

    const SELECTORS = {
        REPORT_TABLE: 'table#ReportBody',
        FROM_DATE_INPUT: 'input#FROMDATE',
        TO_DATE_INPUT: 'input#TODATE',
        SPINNER_BUTTON: '#SpinningThingy'
    };

    function getElement(selector) {
        return document.querySelector(selector);
    }

    function hasResults() {
        return Boolean(getElement(SELECTORS.REPORT_TABLE));
    }

    function getWeekStart(date) {
        const d = new Date(date);
        const dayOffset = (d.getDay() === 0 ? -6 : 1) - d.getDay();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function getDateFromInput(selector) {
        const input = getElement(selector);
        if (!input || !input.value) {
            return null;
        }

        const [day, month, year] = input.value.split('.');
        return new Date(year, month - 1, day);
    }

    function adjustFromDateToWeekStart() {
        const fromDateInput = getElement(SELECTORS.FROM_DATE_INPUT);
        if (!fromDateInput) {
            return;
        }

        const selectedDate = getDateFromInput(SELECTORS.FROM_DATE_INPUT);
        if (!selectedDate) {
            return;
        }

        fromDateInput.value = getWeekStart(selectedDate).toLocaleDateString('de-DE');
    }

    function triggerSubmission() {
        const spinnerButton = getElement(SELECTORS.SPINNER_BUTTON);
        if (spinnerButton) {
            spinnerButton.click();
        }
    }

    function daysUntilNextMonth(date) {
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        return Math.round((nextMonth - date) / (1000 * 60 * 60 * 24));
    }

    function addTableLabels() {
        const table = getElement(SELECTORS.REPORT_TABLE);
        if (!table) {
            return;
        }

        const firstRow = table.rows[0];
        if (!firstRow) {
            return;
        }

        const labelRow = firstRow.cloneNode(true);
        const cellWidth = labelRow.cells[1].firstElementChild.width;

        const fromDate = getDateFromInput(SELECTORS.FROM_DATE_INPUT);
        const toDate = getDateFromInput(SELECTORS.TO_DATE_INPUT);

        if (!fromDate || !toDate) {
            return;
        }

        const elements = [];
        let currentDate = new Date(fromDate);

        while (currentDate < toDate) {
            const div = document.createElement('div');
            div.style.display = 'inline-block';

            let dayCount = daysUntilNextMonth(currentDate);
            const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
            if (monthEnd > toDate) {
                dayCount = Math.floor((toDate - currentDate) / (1000 * 60 * 60 * 24)) + 1;
            }
            div.style.width = `${cellWidth * dayCount}px`;

            div.style.border = '1px solid gray';
            div.style.textAlign = 'center';
            div.style.overflow = 'hidden';

            const title = currentDate.toLocaleString('default', { month: 'short' }) + ' ' + currentDate.getFullYear();
            div.innerText = title;
            div.title = title;

            elements.push(div);

            // Move to the 1st of the next month
            currentDate.setMonth(currentDate.getMonth() + 1, 1);
        }

        // Clear existing content
        labelRow.cells[1].innerHTML = '';

        // Append new elements
        labelRow.cells[1].append(...elements);

        table.tBodies[0].insertBefore(labelRow, firstRow);
    }

    if (!hasResults()) {
        adjustFromDateToWeekStart();
        triggerSubmission();
    } else {
        addTableLabels();
    }

})();
