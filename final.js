const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const fuzzysort = require('fuzzysort');
const { OpenAI } = require('openai');

// Initialize OpenAI
// const openai = new OpenAI({
//      // Replace with your actual OpenAI API key
// });

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function validateResumePath(resumePath) {
    if (!resumePath) {
        throw new Error("Resume path is required");
    }
    
    // Convert Windows backslashes to forward slashes
    const formattedPath = resumePath.replace(/\\/g, '/');
    
    // Check if file exists
    if (!fs.existsSync(formattedPath)) {
        throw new Error(`Resume file not found at path: ${formattedPath}`);
    }
    
    // Check file extension
    const validExtensions = ['.pdf', '.doc', '.docx'];
    const fileExtension = path.extname(formattedPath).toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
        throw new Error(`Invalid file format. Supported formats are: ${validExtensions.join(', ')}`);
    }
    
    // Check file size (max 2MB)
    const stats = fs.statSync(formattedPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    if (fileSizeInMB > 2) {
        throw new Error(`Resume file size (${fileSizeInMB.toFixed(2)}MB) exceeds the 2MB limit`);
    }
    
    return formattedPath;
}

async function getGPTResponse(question, resumeData) {
    try {
        const prompt = `
Given this resume information:
${JSON.stringify(resumeData, null, 2)}

Generate a professional and relevant response for the following job application question:
"${question}"

The response should be:
1. Consistent with the resume information
2. Professional and well-written
3. Specific but concise (max 2-3 sentences unless a longer response is clearly needed)
4. Relevant to the question asked
5. Highlight relevant skills and experience from the resume`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { 
                    "role": "system", 
                    "content": "You are a professional job application assistant helping to fill out application forms based on resume data. Provide concise, relevant, and professional responses."
                },
                { "role": "user", "content": prompt }
            ],
            max_tokens: 150,
            temperature: 0.7
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating GPT response:', error);
        return null;
    }
}


class LinkedInLoginBot {
    constructor(username, password, resumeData, jobFilters, resumePath) {
        
        this.username = username;
        this.password = password;
        this.resumeData = resumeData;
        this.jobFilters = jobFilters;
        this.resumePath = validateResumePath(resumePath);  // Validate on initialization
        this.browser = null;
        this.page = null;
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
        this.page = await this.browser.newPage();
        await this.page.setDefaultNavigationTimeout(30000);
    }

    async startLinkedIn() {
        console.log("Logging in to LinkedIn");
        await this.page.goto("https://www.linkedin.com/login");
        
        await this.page.type("#username", this.username);
        await this.page.type("#password", this.password);
        await this.page.click('button[type="submit"]');
        
        await this.page.waitForSelector("#global-nav", { timeout: 60000 });
        console.log("Successfully logged in to LinkedIn");
        await delay(3000);
    }

    constructJobSearchUrl(jobTitle, location) {
        const baseUrl = "https://www.linkedin.com/jobs/search/?";
        const params = new URLSearchParams({
            keywords: jobTitle,
            location: location,
            distance: "25",
            f_AL: this.jobFilters.easy_apply ? "true" : "false",
        });

        if (this.jobFilters.experience_level) {
            const experienceLevels = {
                "Internship": "1",
                "Entry level": "2",
                "Associate": "3",
                "Mid-Senior level": "4",
                "Director": "5",
                "Executive": "6"
            };
            params.append("f_E", experienceLevels[this.jobFilters.experience_level]);
        }

        if (this.jobFilters.work_type) {
            const workTypes = {
                "Remote": "2",
                "On-site": "1",
                "Hybrid": "3"
            };
            params.append("f_WT", workTypes[this.jobFilters.work_type]);
        }

        return baseUrl + params.toString();
    }

    async searchJobs(jobTitle, location) {
        const searchUrl = this.constructJobSearchUrl(jobTitle, location);
        await this.page.goto(searchUrl);
        console.log(`Navigated to job search results for ${jobTitle} in ${location} with applied filters`);
        await delay(5000);
        
        let processedJobIds = new Set();
        let consecutiveNoNewJobs = 0;
        const MAX_NO_NEW_JOBS = 3; // Stop after 3 consecutive scrolls with no new jobs
        
        while (consecutiveNoNewJobs < MAX_NO_NEW_JOBS) {
            const newJobsFound = await this.extractJobLinksFromCurrentView(processedJobIds);
            
            if (newJobsFound === 0) {
                consecutiveNoNewJobs++;
            } else {
                consecutiveNoNewJobs = 0;
            }
            
            // Scroll to load more results
            const hasMoreJobs = await this.scrollAndLoadMore();
            if (!hasMoreJobs) {
                console.log("Reached end of job listings");
                break;
            }
            
            await delay(2000);
        }
        
        console.log(`Total unique jobs processed: ${processedJobIds.size}`);
    }
    async extractJobLinksFromCurrentView(processedJobIds) {
        try {
            // Wait for job cards to be loaded
            await this.page.waitForSelector('.job-card-container', { 
                timeout: 10000 
            });
            
            // Wait for lazy-loaded content
            await this.page.waitForFunction(() => {
                const cards = document.querySelectorAll('.job-card-container');
                return cards.length > 0 && Array.from(cards).every(card => 
                    card.getBoundingClientRect().height > 0
                );
            }, { timeout: 10000 });
            
            // Get all job cards with retry mechanism
            let jobCards = [];
            for (let attempt = 0; attempt < 3; attempt++) {
                jobCards = await this.page.$$('.job-card-container');
                if (jobCards.length > 7) break;  // If we found more than 7 cards, proceed
                console.log(`Attempt ${attempt + 1}: Found ${jobCards.length} cards, retrying...`);
                await delay(2000);  // Wait before retry
            }

            console.log(`Found ${jobCards.length} job cards in current view`);
            let newJobsCount = 0;
            
            for (const jobCard of jobCards) {
                try {
                    const jobId = await jobCard.evaluate(el => el.getAttribute('data-job-id'));
                    const jobTitle = await jobCard.evaluate(el => {
                        const titleEl = el.querySelector('.job-card-list__title');
                        return titleEl ? titleEl.textContent.trim() : 'Unknown Title';
                    });
                    
                    if (jobId && !processedJobIds.has(jobId)) {
                        processedJobIds.add(jobId);
                        newJobsCount++;
                        
                        console.log(`Processing job ${newJobsCount}: ${jobTitle} (ID: ${jobId})`);
                        
                        // Ensure the card is in view before clicking
                        await this.page.evaluate(async (card) => {
                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Wait for any animations to complete
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }, jobCard);
                        
                        await delay(1000);  // Wait for scroll to complete
                        
                        const isVisible = await jobCard.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.top >= 0 && rect.bottom <= window.innerHeight;
                        });
                        
                        if (!isVisible) {
                            console.log(`Job card not fully visible, adjusting view...`);
                            await this.page.evaluate((card) => {
                                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, jobCard);
                            await delay(1000);
                        }
                        
                        // Click and process the job
                        await this.clickWithRetry(jobCard);
                        await delay(2000);
                        
                        if (!(await this.isAlreadyApplied())) {
                            if (await this.clickEasyApply()) {
                                await this.handleApplicationProcess();
                                console.log(`Completed application for: ${jobTitle}`);
                            } else {
                                console.log(`Easy Apply not available for: ${jobTitle}`);
                            }
                        } else {
                            console.log(`Already applied to: ${jobTitle}`);
                        }
                        
                        // Additional delay between applications
                        await delay(2000);
                    }
                } catch (error) {
                    console.error(`Error processing job card: ${error}`);
                    continue;
                }
            }
            
            return newJobsCount;
            
        } catch (error) {
            console.error(`Error in extractJobLinksFromCurrentView: ${error}`);
            return 0;
        }
    }

    async scrollAndLoadMore() {
        const previousHeight = await this.page.evaluate('document.body.scrollHeight');
        
        // Scroll in smaller increments
        await this.page.evaluate(async () => {
            const totalScroll = document.body.scrollHeight - window.innerHeight;
            const steps = 5;
            const delay = 100;
            
            for (let i = 0; i <= steps; i++) {
                const scrollPosition = (i / steps) * totalScroll;
                window.scrollTo(0, scrollPosition);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        });
        
        try {
            // Wait for new content to load
            await Promise.race([
                // Wait for height change
                this.page.waitForFunction(
                    `document.body.scrollHeight > ${previousHeight}`,
                    { timeout: 5000 }
                ),
                // Wait for "No more jobs" message
                this.page.waitForSelector('.jobs-search-no-results-banner', {
                    timeout: 5000 
                }),
                // Wait for "End of results" message
                this.page.waitForSelector('.jobs-search-results-list__pagination', {
                    timeout: 5000
                })
            ]);
            
            // Check if we've reached the end
            const noMoreJobs = await this.page.$('.jobs-search-no-results-banner, .jobs-search-results-list__pagination');
            if (noMoreJobs) {
                console.log("Reached end of job listings");
                return false;
            }
            
            // Wait for spinner to disappear
            const spinner = await this.page.$('.artdeco-loader');
            if (spinner) {
                await this.page.waitForFunction(
                    () => !document.querySelector('.artdeco-loader'),
                    { timeout: 10000 }
                );
            }
            
            // Additional wait for content to settle
            await delay(2000);
            
            // Verify new content loaded
            const newHeight = await this.page.evaluate('document.body.scrollHeight');
            return newHeight > previousHeight;
            
        } catch (error) {
            console.log("No more jobs to load or timeout reached");
            return false;
        }
    }

    // Add a new method to handle pagination if available
    async checkForPagination() {
        const paginationExists = await this.page.$('.artdeco-pagination__button--next');
        if (paginationExists) {
            console.log("Found pagination, clicking next page...");
            await this.safeClick(paginationExists);
            await delay(3000);
            return true;
        }
        return false;
    }

    async isAlreadyApplied() {
        const appliedStatus = await this.page.$('span.artdeco-inline-feedback__message');
        if (appliedStatus) {
            const text = await this.page.evaluate(el => el.textContent, appliedStatus);
            if (text.includes('Applied')) {
                console.log("Already applied to this job");
                return true;
            }
        }
        return false;
    }

    async clickEasyApply() {
        try {
            await this.page.waitForSelector('button[aria-label^="Easy Apply to"]', { 
                visible: true, 
                timeout: 10000 
            });
    
            const easyApplyButton = await this.page.$('button[aria-label^="Easy Apply to"]');
            if (easyApplyButton) {
                await easyApplyButton.click();
                console.log("Clicked Easy Apply button");
                return true;
            } else {
                console.log("Easy Apply button not found");
                return false;
            }
        } catch (err) {
            console.error('Error clicking Easy Apply button:', err);
            return false;
        }
    }

    async handleApplicationProcess() {
        await this.clickContinueApplying();

        while (true) {
            if (!(await this.waitForFormElements())) {
                console.log("No new form elements loaded");
                break;
            }

            await this.parseAndFillForm();

            const uploadButton = await this.page.$('label.jobs-document-upload__upload-button');
            if (uploadButton) {
                await this.uploadResume();
            }

            if (!(await this.clickNextOrSubmit())) {
                break;
            }
        }

        await this.handleConfirmation();
    }

    async clickContinueApplying() {
        const continueButton = await this.page.$('button[aria-label="Continue to next step"]');
        if (continueButton) {
            await continueButton.click();
            console.log("Clicked 'Continue applying' button");
        } else {
            console.log("No 'Continue applying' button found, proceeding with application");
        }
    }

    async waitForFormElements(timeout = 10000) {
        try {
            await this.page.waitForSelector('form input, form select, form textarea', { timeout });
            await this.page.waitForFunction(() => {
                return !document.querySelector('div.loading-spinner');
            }, { timeout });
            return true;
        } catch (error) {
            console.error("Form elements did not load within the expected time");
            return false;
        }
    }
    async handleTextareaField(element, value) {
        try {
            const label = await this.findLabelForField(element);
            const ariaLabel = await element.evaluate(el => el.getAttribute('aria-label'));
            const isRequired = await element.evaluate(el => el.hasAttribute('required'));
            
            // Check if this is a cover letter field
            const isCoverLetter = await element.evaluate(el => {
                const labelText = el.getAttribute('aria-label')?.toLowerCase() || '';
                const nearbyLabels = Array.from(document.querySelectorAll('label'))
                    .map(l => l.textContent.toLowerCase());
                
                return labelText.includes('cover letter') || 
                       nearbyLabels.some(text => text.includes('cover letter')) ||
                       el.id.toLowerCase().includes('cover') ||
                       el.className.toLowerCase().includes('cover');
            });
    
            if (isCoverLetter) {
                // Specific prompt for cover letter
                const coverLetterPrompt = `
    Generate a professional cover letter based on this resume data:
    ${JSON.stringify(this.resumeData, null, 2)}
    
    Requirements:
    1. Keep it concise (3-4 paragraphs)
    2. Highlight relevant skills and experience
    3. Show enthusiasm for the role
    4. Maintain professional tone
    5. Include specific achievements from resume
    6. Express interest in contributing to the company
    7. End with a call to action
    
    Format: Professional cover letter text only, no subject/date/address headers needed.`;
    
                const coverLetterContent = await getGPTResponse(coverLetterPrompt, this.resumeData);
                
                // Format the cover letter content
                const formattedContent = coverLetterContent.trim()
                    .replace(/\n{3,}/g, '\n\n') // Remove excess line breaks
                    .replace(/Dear Hiring Manager,?\s*/i, '') // Remove salutation if present
                    .replace(/Sincerely,?.*$/i, '') // Remove closing if present
                    .trim();
    
                // Input the content
                await this.safeSendKeys(element, formattedContent);
                console.log('Cover letter content added');
            } else {
                // Handle regular textarea
                await this.safeSendKeys(element, value);
            }
    
            // Verify the content was entered
            const contentEntered = await element.evaluate(el => el.value.length > 0);
            if (!contentEntered) {
                throw new Error('Content not entered properly');
            }
    
            // Check for error states
            const hasError = await element.evaluate(el => 
                el.classList.contains('fb-dash-form-element__error-field') ||
                el.classList.contains('artdeco-text-input--error')
            );
    
            if (hasError) {
                console.log('Textarea shows error state after input');
                // Attempt to fix common issues
                await element.evaluate(el => {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
            }
    
        } catch (error) {
            console.error('Error handling textarea:', error);
            // Fallback content if needed
            const fallbackContent = `Dear Hiring Manager,
    
    I am writing to express my strong interest in the position. With ${this.resumeData['years of experience']} years of experience in ${this.resumeData['skills']}, I am confident in my ability to contribute effectively to your team.
    
    Thank you for considering my application. I look forward to discussing how I can contribute to your organization.
    
    Best regards`;
            
            await this.safeSendKeys(element, fallbackContent);
        }
    }
    
    // Add this helper method to the class
    async findLabelForField(element) {
        try {
            const label = await element.evaluate(el => {
                // Check for label with matching 'for' attribute
                if (el.id) {
                    const associatedLabel = document.querySelector(`label[for="${el.id}"]`);
                    if (associatedLabel) {
                        return associatedLabel.textContent.trim();
                    }
                }
                
                // Check for parent label
                const parentLabel = el.closest('label');
                if (parentLabel) {
                    return parentLabel.textContent.trim();
                }
                
                // Check for aria-label
                if (el.getAttribute('aria-label')) {
                    return el.getAttribute('aria-label').trim();
                }
                
                // Check for nearby label
                const parentContainer = el.closest('.ember-view') || el.parentElement;
                if (parentContainer) {
                    const nearbyLabel = parentContainer.querySelector('label');
                    if (nearbyLabel) {
                        return nearbyLabel.textContent.trim();
                    }
                }
                
                return '';
            });
            
            return label;
        } catch (error) {
            console.error('Error finding label:', error);
            return '';
        }
    }

    async parseAndFillForm() {
        const form = await this.page.$('form');
        if (!form) {
            console.log("No form found");
            return;
        }
    
        // First, handle all fieldset elements (radio button groups)
        const fieldsetElements = await form.$$('fieldset');
        for (const fieldset of fieldsetElements) {
            await this.handleRadioButtonGroup(fieldset);
        }
    
        // Get all form elements
        const formElements = await form.$$('input, select, textarea');
    
        for (const element of formElements) {
            try {
                const elementType = await element.evaluate(el => el.tagName.toLowerCase());
                const fieldId = await element.evaluate(el => el.id);
                const label = await this.findLabelForField(element);
                
                // Get detailed field validation info
                const fieldInfo = await element.evaluate(el => {
                    const info = {
                        type: el.type || el.tagName.toLowerCase(),
                        name: el.name,
                        id: el.id,
                        className: el.className,
                        isNumeric: false,
                        isDecimal: false,
                        hasMinValue: false,
                        minValue: null,
                        hasMaxValue: false,
                        maxValue: null,
                        isRequired: el.required || el.classList.contains('required') || 
                                   el.classList.contains('artdeco-text-input--state-required') || false,
                        isCombobox: el.getAttribute('role') === 'combobox',
                        hasError: el.classList.contains('fb-dash-form-element__error-field') || 
                                 el.classList.contains('artdeco-text-input--error'),
                        ariaLabel: el.getAttribute('aria-label'),
                        ariaRequired: el.getAttribute('aria-required') === 'true',
                        placeholder: el.placeholder,
                        accept: el.accept
                    };
    
                    // Enhanced numeric detection
                    if (el.type === 'number' || 
                        el.classList.contains('numeric') || 
                        el.id.toLowerCase().includes('numeric') ||
                        el.getAttribute('data-type') === 'numeric' ||
                        (el.pattern && el.pattern.includes('\\d')) ||
                        el.classList.contains('artdeco-text-input--type-number')) {
                        info.isNumeric = true;
                    }
    
                    // Enhanced decimal validation detection
                    const errorElement = document.querySelector(`#${el.id}-error`) || 
                                       document.querySelector(`[aria-describedby*="${el.id}-error"]`);
                    if (errorElement) {
                        const errorText = errorElement.textContent.toLowerCase();
                        info.isDecimal = errorText.includes('decimal') || 
                                       errorText.includes('number larger than 0.0') ||
                                       errorText.includes('enter a decimal number');
                    }
    
                    // Get min/max values from various sources
                    if (el.hasAttribute('min')) {
                        info.hasMinValue = true;
                        info.minValue = parseFloat(el.getAttribute('min'));
                    } else if (el.getAttribute('aria-valuemin')) {
                        info.hasMinValue = true;
                        info.minValue = parseFloat(el.getAttribute('aria-valuemin'));
                    }
    
                    if (el.hasAttribute('max')) {
                        info.hasMaxValue = true;
                        info.maxValue = parseFloat(el.getAttribute('max'));
                    } else if (el.getAttribute('aria-valuemax')) {
                        info.hasMaxValue = true;
                        info.maxValue = parseFloat(el.getAttribute('aria-valuemax'));
                    }
    
                    return info;
                });
    
                // Skip if element is not visible or is disabled
                const isVisible = await element.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style && style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           style.opacity !== '0';
                });
                
                if (!isVisible) {
                    console.log(`Skipping invisible element: ${fieldId}`);
                    continue;
                }
    
                // Enhanced context for GPT with specific field requirements
                const fieldContext = {
                    question: label || fieldInfo.ariaLabel || fieldInfo.placeholder || fieldId,
                    fieldType: fieldInfo.type,
                    constraints: {
                        required: fieldInfo.isRequired || fieldInfo.ariaRequired,
                        isNumeric: fieldInfo.isNumeric,
                        isDecimal: fieldInfo.isDecimal,
                        minValue: fieldInfo.minValue,
                        maxValue: fieldInfo.maxValue,
                        isCombobox: fieldInfo.isCombobox,
                        className: fieldInfo.className
                    }
                };
    
                // Enhanced GPT prompt with detailed context
                const prompt = `
    For this job application field:
    
    Question/Label: ${fieldContext.question}
    Field Type: ${fieldContext.fieldType}
    ${fieldContext.constraints.className ? `Field Class: ${fieldContext.constraints.className}\n` : ''}
    Requirements:
    ${fieldContext.constraints.required ? '- Required field\n' : ''}
    ${fieldContext.constraints.isNumeric ? '- Must be numeric\n' : ''}
    ${fieldContext.constraints.isDecimal ? '- Must be a decimal number\n' : ''}
    ${fieldContext.constraints.minValue !== null ? `- Minimum value: ${fieldContext.constraints.minValue}\n` : ''}
    ${fieldContext.constraints.maxValue !== null ? `- Maximum value: ${fieldContext.constraints.maxValue}\n` : ''}
    
    Generate an appropriate response that:
    1. Is specific to the field type and question
    2. Matches format requirements (numeric/decimal)
    3. Stays within any min/max limits
    4. Is based on the resume data
    5. Is professional and job-appropriate
    
    Resume Data:
    ${JSON.stringify(this.resumeData, null, 2)}
    
    Return only the response value, no explanation.`;
    
                let value = await getGPTResponse(prompt, this.resumeData);
    
                // Handle different element types
                switch (elementType) {
                    case 'input':
                        const inputType = await element.evaluate(el => el.type);
                        
                        switch (inputType) {
                            case 'text':
                            case 'email':
                            case 'tel':
                                if (fieldInfo.isNumeric || fieldInfo.isDecimal) {
                                    value = this.formatNumericValue(value, fieldInfo);
                                }
                                if (fieldInfo.isCombobox) {
                                    await this.handleComboboxField(element, value);
                                } else {
                                    await this.handleInputField(element, value);
                                }
                                break;
    
                            case 'number':
                                value = this.formatNumericValue(value, fieldInfo);
                                await this.handleInputField(element, value);
                                break;
    
                            case 'radio':
                                try {
                                    const groupName = await element.evaluate(el => el.name);
                                    const radioGroup = await this.page.$$(`input[type="radio"][name="${groupName}"]`);
                                    const radioLabels = await Promise.all(radioGroup.map(async radio => {
                                        const radioId = await radio.evaluate(el => el.id);
                                        const label = await this.page.$(`label[for="${radioId}"]`);
                                        return label ? await label.evaluate(el => el.textContent.trim()) : '';
                                    }));
    
                                    const fieldsetQuestion = await element.evaluate(el => {
                                        const fieldset = el.closest('fieldset');
                                        if (fieldset) {
                                            const legend = fieldset.querySelector('legend');
                                            return legend ? legend.textContent.trim() : '';
                                        }
                                        return '';
                                    });
    
                                    const radioPrompt = `
    Question: ${fieldsetQuestion || label || fieldInfo.ariaLabel || 'Make a selection'}
    Type: Radio Button Group
    Options: ${radioLabels.join(', ')}
    
    Based on the resume information and this question, which option should be selected?
    Consider:
    1. If it's about work authorization, visa, or legal right to work
    2. If it's about willingness to travel or relocate
    3. If it's about job preferences or availability
    4. If it's about professional qualifications or experience
    
    Return only the exact text of the option that should be selected.
    
    Resume Data:
    ${JSON.stringify(this.resumeData, null, 2)}`;
    
                                    const selectedOption = await getGPTResponse(radioPrompt, this.resumeData);
    
                                    if (selectedOption) {
                                        const bestMatch = fuzzysort.go(
                                            selectedOption.toLowerCase(),
                                            radioLabels.map(label => label.toLowerCase()),
                                            { threshold: -5000 }
                                        );
    
                                        if (bestMatch.length > 0) {
                                            const matchIndex = bestMatch[0].index;
                                            await this.safeClick(radioGroup[matchIndex]);
                                            console.log(`Selected radio option: ${radioLabels[matchIndex]}`);
                                        } else {
                                            // Default handling for no match
                                            for (let i = 0; i < radioLabels.length; i++) {
                                                const label = radioLabels[i].toLowerCase();
                                                if (label.includes('yes') || 
                                                    label.includes('willing') || 
                                                    label.includes('able to')) {
                                                    await this.safeClick(radioGroup[i]);
                                                    console.log(`Selected default positive radio option: ${radioLabels[i]}`);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } catch (error) {
                                    console.error(`Error handling radio button: ${error}`);
                                    const fieldset = await element.evaluateHandle(el => el.closest('fieldset'));
                                    if (fieldset) {
                                        await this.handleRadioButtonGroup(fieldset);
                                    }
                                }
                                break;
    
                            case 'file':
                                try {
                                    const isResumeUpload = await element.evaluate(el => {
                                        const nearbyLabels = Array.from(document.querySelectorAll('label'))
                                            .filter(label => label.offsetParent !== null)
                                            .map(label => label.textContent.toLowerCase());
                                        
                                        return nearbyLabels.some(text => 
                                            text.includes('resume') || 
                                            text.includes('cv') || 
                                            text.includes('upload your') || 
                                            text.includes('attach')
                                        ) || 
                                        el.classList.contains('jobs-document-upload__input') ||
                                        el.closest('.jobs-document-upload__container') !== null;
                                    });
    
                                    if (isResumeUpload) {
                                        const uploadedItem = await this.page.$('.jobs-document-upload__uploaded-item');
                                        if (!uploadedItem) {
                                            console.log('Initiating resume upload via file input');
                                            await this.uploadResume();
                                        } else {
                                            console.log('Resume already uploaded');
                                        }
                                    }
                                } catch (error) {
                                    console.error(`Error handling file input: ${error}`);
                                    await this.uploadResume();
                                }
                                break;
    
                            case 'checkbox':
                                const shouldCheck = String(value).toLowerCase().includes('yes') || 
                                                 String(value).toLowerCase().includes('true');
                                if (shouldCheck) {
                                    await this.safeClick(element);
                                }
                                break;
                        }
                        break;
    
                    case 'select':
                        await this.handleSelectField(element, value);
                        break;
    
                    case 'textarea':
                        await this.handleTextareaField(element, value);
                        break;
                }
    
                // Verify field completion if required
                if (fieldInfo.isRequired) {
                    const isComplete = await this.verifyFieldCompletion(element, fieldInfo);
                    if (!isComplete) {
                        console.log(`Warning: Required field ${fieldId} may not be properly filled`);
                    }
                }
    
                // Add small delay between fields
                await delay(1000);
    
            } catch (error) {
                console.error(`Error handling form element: ${error}`);
                continue;
            }
        }
    
        console.log("Form filling completed");
    }
    
    // Helper method to format numeric values
    formatNumericValue(value, fieldInfo) {
        let numValue = typeof value === 'string' ? 
            parseFloat(value.match(/\d+\.?\d*/)?.[0] || '0') : 
            parseFloat(value);
    
        if (isNaN(numValue)) {
            numValue = 0;
        }
    
        if (fieldInfo.hasMinValue && numValue < fieldInfo.minValue) {
            numValue = fieldInfo.minValue;
        }
        if (fieldInfo.hasMaxValue && numValue > fieldInfo.maxValue) {
            numValue = fieldInfo.maxValue;
        }
    
        return fieldInfo.isDecimal ? numValue.toFixed(1) : Math.floor(numValue).toString();
    }
    
    // Helper method to verify field completion
    async verifyFieldCompletion(element, fieldInfo) {
        try {
            return await element.evaluate((el, info) => {
                if (el.type === 'checkbox' || el.type === 'radio') {
                    return el.checked;
                }
                if (el.value === '') {
                    return false;
                }
                if (info.isNumeric || info.isDecimal) {
                    const numValue = parseFloat(el.value);
                    if (isNaN(numValue)) {
                        return false;
                    }
                    if (info.hasMinValue && numValue < info.minValue) {
                        return false;
                    }
                    if (info.hasMaxValue && numValue > info.maxValue) {
                        return false;
                    }
                }
                return true;
            }, fieldInfo);
        } catch (error) {
            console.error(`Error verifying field completion: ${error}`);
            return false;
        }
    }
    
    // Helper method to format numeric values
    formatNumericValue(value, fieldInfo) {
        let numValue = typeof value === 'string' ? 
            parseFloat(value.match(/\d+\.?\d*/)?.[0] || '0') : 
            parseFloat(value);
    
        if (isNaN(numValue)) {
            numValue = 0;
        }
    
        if (fieldInfo.hasMinValue && numValue < fieldInfo.minValue) {
            numValue = fieldInfo.minValue;
        }
        if (fieldInfo.hasMaxValue && numValue > fieldInfo.maxValue) {
            numValue = fieldInfo.maxValue;
        }
    
        return fieldInfo.isDecimal ? numValue.toFixed(1) : Math.floor(numValue).toString();
    }
    
    // Helper method to verify field completion
    async verifyFieldCompletion(element, fieldInfo) {
        try {
            return await element.evaluate((el, info) => {
                if (el.type === 'checkbox' || el.type === 'radio') {
                    return el.checked;
                }
                if (el.value === '') {
                    return false;
                }
                if (info.isNumeric || info.isDecimal) {
                    const numValue = parseFloat(el.value);
                    if (isNaN(numValue)) {
                        return false;
                    }
                    if (info.hasMinValue && numValue < info.minValue) {
                        return false;
                    }
                    if (info.hasMaxValue && numValue > info.maxValue) {
                        return false;
                    }
                }
                return true;
            }, fieldInfo);
        } catch (error) {
            console.error(`Error verifying field completion: ${error}`);
            return false;
        }
    }
    
    // Helper method to format numeric values
    formatNumericValue(value, fieldInfo) {
        // Extract numbers from string if present
        let numValue = typeof value === 'string' ? 
            parseFloat(value.match(/\d+\.?\d*/)?.[0] || '0') : 
            parseFloat(value);
    
        if (isNaN(numValue)) {
            numValue = 0;
        }
    
        // Apply min/max constraints
        if (fieldInfo.hasMinValue && numValue < fieldInfo.minValue) {
            numValue = fieldInfo.minValue;
        }
        if (fieldInfo.hasMaxValue && numValue > fieldInfo.maxValue) {
            numValue = fieldInfo.maxValue;
        }
    
        // Format based on decimal requirement
        if (fieldInfo.isDecimal) {
            return numValue.toFixed(1);
        }
        return Math.floor(numValue).toString();
    }
    
    // Helper method to verify field completion
    async verifyFieldCompletion(element, fieldInfo) {
        try {
            return await element.evaluate((el, info) => {
                if (el.type === 'checkbox' || el.type === 'radio') {
                    return el.checked;
                }
                if (el.value === '') {
                    return false;
                }
                if (info.isNumeric || info.isDecimal) {
                    const numValue = parseFloat(el.value);
                    if (isNaN(numValue)) {
                        return false;
                    }
                    if (info.hasMinValue && numValue < info.minValue) {
                        return false;
                    }
                    if (info.hasMaxValue && numValue > info.maxValue) {
                        return false;
                    }
                }
                return true;
            }, fieldInfo);
        } catch (error) {
            console.error(`Error verifying field completion: ${error}`);
            return false;
        }
    }

    async handleRadioButtonGroup(fieldset) {
        try {
            const legend = await fieldset.$('legend');
            const question = await legend.evaluate(el => el.textContent.trim());
            console.log(`Handling radio button group: ${question}`);

            const options = await fieldset.$$('input[type="radio"]');
            const labels = await fieldset.$$('label');

            const selectedOption = await fieldset.$('input[type="radio"]:checked');
            if (selectedOption) {
                const selectedLabel = await this.findLabelForField(selectedOption);
                console.log(`Option already selected: ${selectedLabel}`);
                return;
            }

            const optionsText = await Promise.all(
                labels.map(label => label.evaluate(el => el.textContent.trim()))
            );

            const gptPrompt = `
Question: ${question}
Available options: ${optionsText.join(', ')}
Based on this resume information, which option should be selected? Return only the exact text of the best option.

Resume:
${JSON.stringify(this.resumeData, null, 2)}`;

            const suggestedOption = await getGPTResponse(gptPrompt, this.resumeData);

            if (suggestedOption) {
                for (let i = 0; i < options.length; i++) {
                    const labelText = await labels[i].evaluate(el => el.textContent.trim());
                    if (labelText.toLowerCase() === suggestedOption.toLowerCase()) {
                        await this.safeClick(options[i]);
                        console.log(`Selected option based on GPT suggestion: ${labelText}`);
                        return;
                    }
                }
            }

            // Default selections if GPT suggestion fails
            for (let i = 0; i < options.length; i++) {
                const labelText = await labels[i].evaluate(el => el.textContent.trim());
                if (labelText.toLowerCase() === 'yes') {
                    await this.safeClick(options[i]);
                    console.log("Selected 'Yes' option as default");
                    return;
                }
            }

            if (options.length > 0) {
                await this.safeClick(options[0]);
                console.log(`Selected first option as fallback`);
            }

        } catch (error) {
            console.error(`Error handling radio button group: ${error}`);
        }
    }

    async findLabelForField(field) {
        const fieldId = await field.evaluate(el => el.id);
        if (fieldId) {
            const label = await this.page.$(`label[for="${fieldId}"]`);
            if (label) {
                return await label.evaluate(el => el.textContent.trim());
            }
        }

        const parent = await field.evaluateHandle(el => el.parentElement);
        const label = await parent.$('label');
        if (label) {
            return await label.evaluate(el => el.textContent.trim());
        }

        return null;
    }

    async getBestMatchValue(label) {
        if (!label) return null;

        let bestMatch = null;
        let bestRatio = 0;

        for (const [key, value] of Object.entries(this.resumeData)) {
            const ratio = fuzzysort.single(label.toLowerCase(), key.toLowerCase());
            if (ratio && ratio.score > bestRatio) {
                bestRatio = ratio.score;
                bestMatch = value;
            }
        }

        // If no good match found, use GPT to generate a response
        if (bestRatio <= -20) {
            console.log(`No direct match found for '${label}', generating response with GPT`);
            const gptResponse = await getGPTResponse(label, this.resumeData);
            if (gptResponse) {
                console.log(`GPT generated response for '${label}': ${gptResponse}`);
                return gptResponse;
            }
        }

        console.log(`Best match for '${label}': ${bestMatch} (ratio: ${bestRatio})`);
        return bestMatch;
    }

    async handleInputField(field, value) {
        try {
            await this.safeSendKeys(field, value);
            await delay(1000);

            const isCombobox = await field.evaluate(el => 
                el.getAttribute('role') === 'combobox' && 
                el.getAttribute('aria-autocomplete') === 'list'
            );

            if (isCombobox) {
                await this.handleAutocomplete(field, value);
            } else {
                await field.press('Enter');
            }
        } catch (error) {
            console.warn(`Failed to handle input field: ${error}`);
        }
    }

    async handleAutocomplete(field, value) {
        try {
            await this.page.waitForSelector('ul[role="listbox"] li', { timeout: 5000 });
            
            const options = await this.page.$$('ul[role="listbox"] li');
            
            if (options.length > 0) {
                const optionTexts = await Promise.all(
                    options.map(option => option.evaluate(el => el.textContent.toLowerCase()))
                );
                
                const bestMatchResult = fuzzysort.go(
                    value.toLowerCase(), 
                    optionTexts, 
                    {threshold: -Infinity}
                );
                
                if (bestMatchResult.length > 0) {
                    await this.safeClick(options[bestMatchResult[0].index]);
                    console.log(`Selected autocomplete option: ${optionTexts[bestMatchResult[0].index]}`);
                } else {
                    await this.safeClick(options[0]);
                    console.log('Selected first autocomplete option as fallback');
                }
            } else {
                await field.press('Enter');
                console.log('No autocomplete options found, pressed Enter');
            }
        } catch (error) {
            console.warn(`Failed to handle autocomplete: ${error}`);
            await field.press('Enter');
        }
    }

    async safeSendKeys(element, value) {
        try {
            await element.evaluate(el => el.value = '');
            await element.type(value.toString());
            console.log(`Successfully typed value: ${value}`);
        } catch (error) {
            console.warn(`Failed to send keys to element: ${error}`);
            try {
                await element.evaluate((el, val) => {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, value.toString());
                console.log(`Used alternative method to set value: ${value}`);
            } catch (error2) {
                console.error(`Both typing methods failed: ${error2}`);
            }
        }
    }

    async safeClick(element, label = null, waitTime = 5000) {
        try {
            if (label) {
                const labelElement = await this.page.$(`label:contains("${label}")`);
                await labelElement.click();
            } else {
                await element.click();
            }
            await delay(1000);
            console.log(`Successfully clicked element: ${label || 'unnamed element'}`);
        } catch (error) {
            console.warn(`Failed to click element: ${error}`);
            try {
                await this.page.evaluate(el => {
                    el.dispatchEvent(new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                }, element);
                console.log("Used alternative click method");
            } catch (error2) {
                console.error(`Alternative click method also failed: ${error2}`);
            }
        }
    }

    async clickNextOrSubmit() {
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(2000);

        const buttonSelector = `
            button:is(
                [aria-label="Continue to next step"],
                [aria-label="Review your application"],
                [aria-label="Submit application"]
            )
        `;
        
        try {
            const button = await this.page.waitForSelector(buttonSelector, {
                visible: true,
                timeout: 10000
            });
            
            await this.page.evaluate(el => el.scrollIntoView(), button);
            await delay(1000);
            
            const buttonText = await button.evaluate(el => el.textContent.toLowerCase());
            
            if (buttonText.includes('review')) {
                console.log("Clicked 'Review' button");
                await this.safeClick(button);
                return true;
            } else if (buttonText.includes('submit') || buttonText.includes('apply')) {
                console.log("Clicked 'Submit' button");
                await this.safeClick(button);
                return false;
            } else {
                console.log("Clicked 'Next' button");
                await this.safeClick(button);
                return true;
            }
        } catch (error) {
            console.error("Could not find 'Next', 'Review', or 'Submit' button:", error);
            return false;
        }
    }

    async uploadResume() {
        try {
            // Wait for the upload button container to be visible
            await this.page.waitForSelector('.js-jobs-document-upload__container', {
                visible: true,
                timeout: 10000
            });
    
            // Get the file input using a more reliable selector approach
            const fileInput = await this.page.evaluateHandle(() => {
                const input = document.querySelector('input[type="file"][accept*="pdf"]');
                return input;
            });
    
            if (!fileInput) {
                console.log("File input element not found");
                return;
            }
    
            // Fix the file path format
            const formattedPath = this.resumePath.replace(/\\/g, '/');
            
            // Upload the file
            await fileInput.uploadFile(formattedPath);
            console.log("Initiated resume upload");
    
            // Wait for either success or error state
            await Promise.race([
                this.page.waitForSelector('div.jobs-document-upload__uploaded-item', {
                    visible: true,
                    timeout: 30000
                }),
                this.page.waitForSelector('.jobs-document-upload__input-error-text', {
                    visible: true,
                    timeout: 30000
                })
            ]);
    
            // Check for error message
            const errorElement = await this.page.$('.jobs-document-upload__input-error-text');
            if (errorElement) {
                const errorText = await errorElement.evaluate(el => el.textContent.trim());
                throw new Error(`Resume upload failed: ${errorText}`);
            }
    
            // If no error, assume success
            console.log(`Resume uploaded successfully: ${formattedPath}`);
            await delay(2000);
    
        } catch (error) {
            console.error(`Error uploading resume: ${error}`);
            
            // Additional error handling for file path issues
            if (error.message.includes("no such file")) {
                console.error("Please check if the resume file exists at the specified path");
                console.error("Current path:", this.resumePath);
            }
        }
    }

    async handleConfirmation() {
        try {
            await this.page.waitForSelector(
                'div[aria-label="confirmation message"]',
                { timeout: 10000 }
            );
            console.log("Application submitted successfully");
            
            const dismissButton = await this.page.$('button[aria-label="Dismiss"]');
            if (dismissButton) {
                await this.safeClick(dismissButton);
                console.log("Closed confirmation dialog");
            }
            
            await delay(2000);
        } catch (error) {
            console.warn("Could not find confirmation message:", error);
        }
    }

    async clickWithRetry(element, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.safeClick(element);
                break;
            } catch (error) {
                if (attempt < maxRetries - 1) {
                    console.warn(`Click attempt ${attempt + 1} failed, retrying...`);
                    await delay(2000);
                } else {
                    console.error(`Failed to click element after ${maxRetries} attempts`);
                    throw error;
                }
            }
        }
    }

    async runJobApplicationProcess(jobTitle, location) {
        try {
            await this.init();
            await this.startLinkedIn();
            await this.searchJobs(jobTitle, location);
        } catch (error) {
            console.error("Error during job application process:", error);
        } finally {
            await this.browser.close();
        }
    }
}

// Example usage
(async () => {
    const config = {
        username: "email",
        password: "pass",
        resumeData: {
            "first name": "Shine",
            "last name": "Gupta",
            "email": "guptashine5002@gmail.com",
            "phone": "+918433135192",
            "location": "Ghaziabad, India",
            "current title": "Data Scientist",
            "years of experience": "5",
            "education": "Bachelor's in Computer Science",
            "skills": "Python, JavaScript, Machine Learning, Data Analysis, SQL, Deep Learning, Node.js, React",
            "desired salary": "150000",
            "Address": "Ghaziabad, Uttar Pradesh",
            "phone country code": "India (+91)",
            "mobile phone number": "8433135192",
            "work_authorization": "Yes, I am legally authorized to work in the US",
            "visa_sponsorship": "No, I do not require visa sponsorship",
            "clearance": "No security clearance",
            "languages": "English (Fluent), Hindi (Native)",
            "linkedin": "https://www.linkedin.com/in/shine-gupta",
            "github": "https://github.com/shinegupta",
            "portfolio": "https://shinegupta.dev"
        },
        jobFilters: {
            easy_apply: true,
            experience_level: "Internship",
            work_type: "Remote"
        },
        resumePath: "C:\\Users\\gupta\\OneDrive\\Desktop\\Gradstem(linkedin)\\Resume__Anonymous_best.pdf"
    };

    const bot = new LinkedInLoginBot(
        config.username,
        config.password,
        config.resumeData,
        config.jobFilters,
        config.resumePath
    );
    

    await bot.runJobApplicationProcess("Software Engineer", "United States");
})();
