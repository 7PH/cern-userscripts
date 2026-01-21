// ==UserScript==
// @name         Hireflix Download Interview Submissions Button
// @namespace    https://github.com/7PH
// @version      0.1.0
// @description  Add a "Download All" button to download all videos from a Hireflix interview submission
// @author       Kevin Kessler (https://github.com/kevin-kessler)
// @match        https://shared.hireflix.com/interview/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=hireflix.com
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @homepage     https://github.com/7PH/cern-userscripts
// @homepageURL  https://github.com/7PH/cern-userscripts
// @source       https://github.com/7PH/cern-userscripts
// @supportURL   https://github.com/7PH/cern-userscripts/issues
// @updateURL    https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/hireflix.com/hireflix-download-interview-submissions-button.user.js
// @downloadURL  https://github.com/7PH/cern-userscripts/raw/refs/heads/master/src/hireflix.com/hireflix-download-interview-submissions-button.user.js
// ==/UserScript==

(function() {
    'use strict';

    const HIREFLIX_BUTTON_CLASSES = 'hf-button is-primary is-medium is-rounded button';
    const DOWNLOAD_BUTTON_STYLE = 'margin: 10px; width: calc(100% - 20px);';
    const DOWNLOAD_BUTTON_TEXT = 'Download All';

    const SELECTORS = {
        videoPlayer: '.vjs-tech',
        questionList: 'aside.menu.question-list',
        questionThumbnail: '.question-title-thumbnail',
        candidateName: '.candidate-name-heading',
        transcriptBox: '.is-hidden-mobile .react-aria-ListBox',
        transcriptParagraph: '.hf-paragraph',
    };

    const SELECTOR_POLLING_DELAY_MS = 100;
    const TRANSCRIPT_POLLING_DELAY_MS = 200;
    const VIDEO_SRC_CHANGE_TIMEOUT_MS = 3000;

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

    async function waitForVideoChange(previousUrl, timeoutMs = VIDEO_SRC_CHANGE_TIMEOUT_MS) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const video = document.querySelector(SELECTORS.videoPlayer);
            if (video && video.src && video.src !== previousUrl) {
                return video.src;
            }
            await sleepFor(SELECTOR_POLLING_DELAY_MS);
        }
        return null;
    }

    function getCandidateName() {
        const el = document.querySelector(SELECTORS.candidateName);
        return el ? el.textContent.trim() : null;
    }

    function sanitizeFilename(name) {
        return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    function getCurrentTranscript() {
        const transcriptBox = document.querySelector(SELECTORS.transcriptBox);
        if (!transcriptBox) return '';

        const paragraphs = transcriptBox.querySelectorAll(SELECTORS.transcriptParagraph);
        const lines = [];
        for (const p of paragraphs) {
            // Format: "0:01Hi everyone..." -> "[0:01] Hi everyone..."
            const text = p.textContent.trim();
            const formatted = text.replace(/^(\d+:\d+)/, '[$1] ');
            lines.push(formatted);
        }
        return lines.join('\n\n');
    }

    async function collectAndDownloadAsZip(updateStatus) {
        const thumbnails = document.querySelectorAll(SELECTORS.questionThumbnail);
        const total = thumbnails.length;
        const candidateName = getCandidateName();
        const zipName = candidateName ? sanitizeFilename(candidateName) : 'hireflix-videos';

        const zip = new JSZip();
        const transcriptParts = [];
        let previousUrl = null;
        let count = 0;

        for (let i = 0; i < total; i++) {
            const thumbnail = document.querySelectorAll(SELECTORS.questionThumbnail)[i];
            if (!thumbnail) continue;

            const questionName = thumbnail.textContent.trim();
            thumbnail.click();

            const videoUrl = await waitForVideoChange(previousUrl);
            if (videoUrl && videoUrl !== previousUrl) {
                previousUrl = videoUrl;
                count++;

                // Collect transcript for this question
                await sleepFor(TRANSCRIPT_POLLING_DELAY_MS);
                const transcript = getCurrentTranscript();
                const paddedIndex = String(i + 1).padStart(2, '0');
                transcriptParts.push(`## ${paddedIndex} - ${questionName}\n\n${transcript || '(No transcript available)'}`);

                // Fetch video for this question
                updateStatus(`Fetching video ${count}/${total}...`);
                const response = await fetch(videoUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const filename = `${paddedIndex}-${sanitizeFilename(questionName)}.mp4`;
                zip.file(filename, await response.blob());
            }
        }

        if (count === 0) return 0;

        // Add transcript ZIP
        const transcriptContent = `# Interview Transcript: ${candidateName || 'Unknown Candidate'}\n\n${transcriptParts.join('\n\n---\n\n')}`;
        zip.file('transcript.txt', transcriptContent);

        updateStatus('Creating ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const blobUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${zipName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        return count;
    }

    function createDownloadButton() {
        const button = document.createElement('button');
        button.className = HIREFLIX_BUTTON_CLASSES;
        button.style.cssText = DOWNLOAD_BUTTON_STYLE;
        button.textContent = DOWNLOAD_BUTTON_TEXT;

        button.addEventListener('click', async () => {
            button.disabled = true;
            const updateStatus = (text) => { button.textContent = text; };

            try {
                const count = await collectAndDownloadAsZip(updateStatus);

                if (count === 0) {
                    console.warn('No videos found!');
                    button.textContent = DOWNLOAD_BUTTON_TEXT;
                    button.disabled = false;
                    return;
                }

                button.textContent = `Done! ${count} videos`;
            } catch (error) {
                console.error('Error:', error);
                button.textContent = DOWNLOAD_BUTTON_TEXT;
            } finally {
                button.disabled = false;
                setTimeout(() => { button.textContent = DOWNLOAD_BUTTON_TEXT; }, 3000);
            }
        });

        return button;
    }

    function disableAutoplay() {
        // Observe video element and pause whenever src changes
        const observer = new MutationObserver(() => {
            const video = document.querySelector(SELECTORS.videoPlayer);
            if (video) {
                video.pause();
            }
        });

        // Watch for video element to appear, then observe it
        const checkForVideo = setInterval(() => {
            const video = document.querySelector(SELECTORS.videoPlayer);
            if (video) {
                video.pause();
                observer.observe(video, { attributes: true, attributeFilter: ['src'] });
                clearInterval(checkForVideo);
            }
        }, SELECTOR_POLLING_DELAY_MS);
    }

    async function main() {
        // disable autoplay when switching questions
        disableAutoplay();

        // wait for the question list to be loaded
        const questionList = await waitForSelector(SELECTORS.questionList, true);

        // add the download button below the question list
        const button = createDownloadButton();
        questionList.parentNode.insertBefore(button, questionList.nextSibling);
        console.log('Hireflix Download button ready');
    }

    main();
})();
