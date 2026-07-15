// ==UserScript==
// @name         CERN EDH Fix Absence Overview
// @namespace    https://github.com/7PH
// @version      0.3.3
// @description  Fixes issues with the AbsenceOverview page.
// @author       7PH (https://github.com/7PH)
// @match        https://edh.cern.ch/Document/Claims/AbsenceOverview*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cern.ch
// @grant        none
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/7PH/cern-userscripts/master/src/edh.cern.ch/fix-absence-overview.user.js
// @downloadURL  https://raw.githubusercontent.com/7PH/cern-userscripts/master/src/edh.cern.ch/fix-absence-overview.user.js
// ==/UserScript==

/**
 * - Add month and day label rows to the table
 * - Highlight today's column and label
 * - Adjust FROMDATE to the start of the week
 * - Trigger submission if no results are shown (never show an empty page)
 * - Add "➕ 1 week" / "➕ 1 month" buttons to extend the displayed period
 * - Add "➖ 1 week" / "➖ 1 month" buttons to move the start date back
 * - Show a shorter version of colleague's names
 * - Click a name to favorite it (favorites are pinned to the top and persisted)
 */

(function () {
    'use strict';

    const SELECTORS = {
        REPORT_TABLE: 'table#ReportBody',
        REPORT_TABLE_BODY: 'table#ReportBody tbody',
        FROM_DATE_INPUT: 'input#FROMDATE',
        TO_DATE_INPUT: 'input#TODATE',
        SPINNER_BUTTON: '#SpinningThingy',
        PERSON_NAME: 'td.person-name',
        PERSON_ROW: 'tr.person-overview',
    };

    const LOCAL_STORAGE_KEY = 'edh.cern.ch.AbsenceOverview.userscript';

    const LAST_NAME_MAX_LENGTH = 8;

    const FAVORITE_ICON = '✔️';

    /**
     * @type {Array<string[]>} Favorite users (list of full names)
     */
    let favorites = [];

    function isFavorite(name) {
        return favorites.includes(name);
    }

    function addToFavorites(name) {
        if (isFavorite(name)) {
            return;
        }
        favorites.push(name);
        saveFavorites();
    }

    function removeFromFavorites(name) {
        favorites = favorites.filter(n => n !== name);
        saveFavorites();
    }

    function saveFavorites() {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(favorites));
    }

    function loadFavorites() {
        try {
            favorites = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) ?? [];
        } catch (error) {
            console.error(`Unable to load favorites ${error}`);
        }
    }

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

    function shiftDateInput(selector, computeNewDate) {
        const date = getDateFromInput(selector);
        const input = getElement(selector);
        input.value = computeNewDate(date).toLocaleDateString('de-DE');
        triggerSubmission();
    }

    function showOneMoreWeek() {
        shiftDateInput(SELECTORS.TO_DATE_INPUT, date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7));
    }

    function showOneMoreMonth() {
        shiftDateInput(SELECTORS.TO_DATE_INPUT, date => new Date(date.getFullYear(), date.getMonth() + 1, 1));
    }

    function showOneLessWeek() {
        shiftDateInput(SELECTORS.FROM_DATE_INPUT, date => new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7));
    }

    function showOneLessMonth() {
        shiftDateInput(SELECTORS.FROM_DATE_INPUT, date => new Date(date.getFullYear(), date.getMonth() - 1, 1));
    }

    function createPeriodShiftButton(label, title, onClick) {
        const div = document.createElement('div');
        div.style.display = 'inline-block';
        div.style.border = '1px solid gray';
        div.style.verticalAlign = 'top';
        div.style.width = '100px';
        div.style.textAlign = 'center';
        div.style.textDecoration = 'underline';
        div.style.cursor = 'pointer';
        div.innerHTML = label;
        div.title = title;
        div.onclick = onClick;
        return div;
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

        const cellWidth = firstRow.cells[1].firstElementChild.width;

        // The label rows' first cell has no explicit width, unlike the name
        // column cells below it; without matching it, the browser's table
        // layout algorithm can size that column too narrow once it holds text.
        const nameCellWidth = getElement(SELECTORS.PERSON_NAME)?.getAttribute('width');
        const applyNameColumnWidth = (cell) => {
            if (!nameCellWidth) {
                return;
            }
            cell.setAttribute('width', nameCellWidth);
            cell.style.width = nameCellWidth;
        };

        const dayLabelRow = firstRow.cloneNode(true);

        const fromDate = getDateFromInput(SELECTORS.FROM_DATE_INPUT);
        const toDate = getDateFromInput(SELECTORS.TO_DATE_INPUT);

        if (!fromDate || !toDate) {
            return;
        }

        // Build month label nodes
        const monthLabelNodes = [];
        const monthLabelRow = firstRow.cloneNode(true);

        // Add a label to move the start date back by 1 month, placed over the name column
        const oneLessMonth = createPeriodShiftButton('➖ 1 month', 'Move the start date back by one month', showOneLessMonth);
        monthLabelRow.cells[0].innerHTML = '';
        monthLabelRow.cells[0].style.textAlign = 'right';
        monthLabelRow.cells[0].append(oneLessMonth);
        applyNameColumnWidth(monthLabelRow.cells[0]);

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

            monthLabelNodes.push(div);

            // Move to the 1st of the next month
            currentDate.setMonth(currentDate.getMonth() + 1, 1);
        }

        // Add a label to display 1 more month of data
        const oneMoreMonth = createPeriodShiftButton('➕ 1 month', 'Display one more month of data', showOneMoreMonth);
        monthLabelNodes.push(oneMoreMonth);

        monthLabelRow.cells[1].innerHTML = '';
        monthLabelRow.cells[1].append(...monthLabelNodes);

        // Build day label nodes
        const dayLabelNodes = [];

        // Add a label to move the start date back by 1 week, placed over the name column
        const oneLessWeek = createPeriodShiftButton('➖ 1 week', 'Move the start date back by one week', showOneLessWeek);
        dayLabelRow.cells[0].innerHTML = '';
        dayLabelRow.cells[0].style.textAlign = 'right';
        dayLabelRow.cells[0].append(oneLessWeek);
        applyNameColumnWidth(dayLabelRow.cells[0]);

        currentDate = new Date(fromDate);
        while (currentDate <= toDate) {
            const div = document.createElement('div');

            const isFirst = currentDate.getDate() === 1;
            const twoDigits = currentDate.getDate() >= 10;
            const isToday = currentDate.toDateString() === new Date().toDateString();
            const isFirstDayOfPeriod = currentDate.toISOString() === fromDate.toISOString();
            const isLastDayOfPeriod = currentDate.toISOString() === toDate.toISOString();
            const showDayLabel = currentDate.getDate() % 2 !== 0 || currentDate.getDate() < 10 || isFirstDayOfPeriod || isLastDayOfPeriod || isToday;

            if (showDayLabel) {
                div.innerText = currentDate.getDate();
                div.style.width = `${cellWidth}px`;
                div.style.height = '24px';
                div.style.display = 'inline-flex';
                div.style.alignItems = 'center';
                div.style.justifyContent = 'center';
                div.style.fontSize = twoDigits ? '12px' : '14px';
                div.style.fontWeight = isToday ? 'bold' : 'normal';
                div.style.borderLeft = `1px solid ${isFirst ? 'black' : 'gray'}`;
                div.style.borderRight = `1px solid ${isFirst ? 'black' : 'gray'}`;
            } else {
                div.style.display = 'inline-block';
                div.style.width = `${cellWidth}px`;
                div.style.height = '24px';
                div.style.verticalAlign = 'bottom';
            }

            // If day is today change its background color
            if (isToday) {
                div.style.backgroundColor = 'rgb(255 237 204)';
            }

            dayLabelNodes.push(div);

            // +1 day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Add a label to display 1 more week of data
        const oneMoreWeek = createPeriodShiftButton('➕ 1 week', 'Display one more week of data', showOneMoreWeek);
        dayLabelNodes.push(oneMoreWeek);

        dayLabelRow.cells[1].innerHTML = '';
        dayLabelRow.cells[1].append(...dayLabelNodes);

        table.tBodies[0].insertBefore(monthLabelRow, firstRow);
        table.tBodies[0].insertBefore(dayLabelRow, firstRow);
        // Remove the original first row
        table.tBodies[0].removeChild(firstRow);
    }

    function fixPersonNames() {
        const anyTd = document.querySelector(SELECTORS.PERSON_NAME);
        const width = anyTd.clientWidth;

        for (const td of document.querySelectorAll(SELECTORS.PERSON_NAME)) {
            const [lastNameFull, firstNameFull] = td.innerText.trim().split(',');

            // Display full last name if short, or only first last names otherwise
            let lastName = '';
            let i = 0;
            const lastNames = lastNameFull.split(' ');
            while (lastName.length < LAST_NAME_MAX_LENGTH && i < lastNames.length) {
                lastName += lastNames[i] + ' ';
                i ++;
            }

            const [firstName] = firstNameFull.trim().split(' ');

            td.title = `${firstNameFull} ${lastNameFull}`.trim();
            td.innerHTML = `${firstName} ${lastName}`;
            td.width = `${width}px`; // Do not change the width
        }
    }

    function addPersonToggleFeature() {
        for (const td of document.querySelectorAll(SELECTORS.PERSON_NAME)) {
            // Toggle-select single-person view on click
            td.onclick = () => {
                const name = td.title;
                if (isFavorite(name)) {
                    removeFromFavorites(name);
                } else {
                    addToFavorites(name);
                }
                rearrangeFavoriteUsers();
            }
            td.style.cursor = 'pointer';
        }
    }

    function highlightCurrentDayColumn() {
        const fromDate = getDateFromInput(SELECTORS.FROM_DATE_INPUT);
        const toDate = getDateFromInput(SELECTORS.TO_DATE_INPUT);

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to midnight

        // If current date isn't in the selected range, nothing to do
        if (today < fromDate || today > toDate) {
            return;
        }

        // Calculate the difference in days between fromDate and today
        const msPerDay = 24 * 60 * 60 * 1000;
        const colIndex = Math.floor((today - fromDate) / msPerDay);

        // Colorize
        for (const element of document.querySelectorAll(`.person-overview td:nth-child(2) > *:nth-child(${colIndex + 1})`)) {
            element.style.borderLeft = '2px solid rgb(227, 150, 122)';
        }
    }

    function rearrangeFavoriteUsers() {
        const rows = document.querySelectorAll(SELECTORS.PERSON_ROW);
        if (rows.length === 0) {
            return;
        }
        const tbody = document.querySelector(SELECTORS.REPORT_TABLE_BODY);
        for (const row of rows) {
            const personNameNode = row.querySelector(SELECTORS.PERSON_NAME);
            const favorite = isFavorite(personNameNode.title);
            if (favorite) {
                if (! personNameNode.innerHTML.includes(FAVORITE_ICON)) {
                    personNameNode.innerHTML = `${personNameNode.innerHTML} ${FAVORITE_ICON}`;
                }
                // Move row to the top, below the label rows
                tbody.insertBefore(row, tbody.childNodes[2]);
                personNameNode.style.fontWeight = 'bold';
            } else if (personNameNode.innerHTML.includes(FAVORITE_ICON)) {
                personNameNode.innerHTML = personNameNode.innerHTML.replace(` ${FAVORITE_ICON}`, '');
                personNameNode.style.fontWeight = 'normal';
            }
        }
    }


    loadFavorites();

    if (!hasResults()) {
        adjustFromDateToWeekStart();
        triggerSubmission();
    } else {
        addTableLabels();
        fixPersonNames();
        addPersonToggleFeature();
        highlightCurrentDayColumn();
        rearrangeFavoriteUsers();
    }

})();
