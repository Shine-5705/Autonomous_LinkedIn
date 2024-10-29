import csv
import time
import logging
import random
import os
from urllib.parse import quote, urlencode
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementClickInterceptedException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from webdriver_manager.chrome import ChromeDriverManager
from fuzzywuzzy import fuzz

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class LinkedInLoginBot:
    def __init__(self, username: str, password: str, resume_data: dict, job_filters: dict, resume_path: str) -> None:
        log.info("Initializing LinkedIn Login Bot")
        self.username = username
        self.password = password
        self.resume_data = resume_data
        self.job_filters = job_filters
        self.resume_path = resume_path
        self.options = self.browser_options()
        self.browser = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=self.options)
        self.wait = WebDriverWait(self.browser, 30)

    def browser_options(self):
        options = webdriver.ChromeOptions()
        options.add_argument("--start-maximized")
        options.add_argument("--ignore-certificate-errors")
        options.add_argument('--no-sandbox')
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-blink-features")
        options.add_argument("--disable-blink-features=AutomationControlled")
        return options

    def start_linkedin(self) -> None:
        log.info("Logging in to LinkedIn")
        self.browser.get("https://www.linkedin.com/login")
        try:
            user_field = self.browser.find_element(By.ID, "username")
            pw_field = self.browser.find_element(By.ID, "password")
            login_button = self.browser.find_element(By.XPATH, '//*[@id="organic-div"]/form/div[3]/button')

            user_field.send_keys(self.username)
            pw_field.send_keys(self.password)
            login_button.click()
            log.info("Credentials submitted")

            self.wait.until(EC.presence_of_element_located((By.ID, "global-nav")))
            log.info("Successfully logged in to LinkedIn")
            time.sleep(3)

        except TimeoutException:
            log.error("TimeoutException! Login failed")

    def construct_job_search_url(self, job_title: str, location: str) -> str:
        base_url = "https://www.linkedin.com/jobs/search/?"
        params = {
            "keywords": job_title,
            "location": location,
            "distance": "25",
            "geoId": "103644278",  # Assuming this is for United States
            "f_AL": "true" if self.job_filters.get("easy_apply", False) else None,
        }

        if self.job_filters.get("experience_level"):
            experience_levels = {
                "Internship": "1",
                "Entry level": "2",
                "Associate": "3",
                "Mid-Senior level": "4",
                "Director": "5",
                "Executive": "6"
            }
            params["f_E"] = experience_levels.get(self.job_filters["experience_level"])

        if self.job_filters.get("work_type"):
            work_types = {
                "Remote": "2",
                "On-site": "1",
                "Hybrid": "3"
            }
            params["f_WT"] = work_types.get(self.job_filters["work_type"])

        # Remove None values
        params = {k: v for k, v in params.items() if v is not None}

        return base_url + urlencode(params)

    def search_jobs(self, job_title: str, location: str) -> None:
        try:
            search_url = self.construct_job_search_url(job_title, location)
            
            self.browser.get(search_url)
            log.info(f"Navigated to job search results for {job_title} in {location} with applied filters")
            time.sleep(5)

            self.extract_job_links()

        except TimeoutException:
            log.error("TimeoutException! Could not search jobs")

    def extract_job_links(self):
        try:
            self.close_pop_ups()  # Close any initial pop-ups
            job_elements = self.wait.until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'job-card-container')))
            log.info(f"Found {len(job_elements)} job cards.")

            for index in range(len(job_elements)):
                try:
                    # Re-locate elements to avoid stale references
                    job_elements = self.wait.until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'job-card-container')))
                    job = job_elements[index]

                    job_id = job.get_attribute("data-job-id")
                    if job_id:
                        job_link = f"https://www.linkedin.com/jobs/search/?currentJobId={job_id}"
                        log.info(f"Working on job link: {job_link}")
                        
                        # Scroll the job into view
                        self.browser.execute_script("arguments[0].scrollIntoView(true);", job)
                        time.sleep(1)  # Short pause after scrolling
                        
                        # Click with retry mechanism
                        max_retries = 3
                        for attempt in range(max_retries):
                            try:
                                self.wait.until(EC.element_to_be_clickable(job)).click()
                                break
                            except ElementClickInterceptedException:
                                if attempt < max_retries - 1:
                                    log.warning(f"Click intercepted, retrying... (Attempt {attempt + 1})")
                                    time.sleep(2)
                                    self.close_pop_ups()
                                else:
                                    log.error(f"Failed to click job after {max_retries} attempts")
                                    raise
                        
                        time.sleep(3)  # Wait for job details to load
                        
                        if not self.is_already_applied():
                            if self.click_easy_apply():
                                self.handle_application_process()
                        
                    time.sleep(2)

                except Exception as e:
                    log.error(f"Error interacting with job card: {e}")

            log.info("Finished extracting and interacting with job links.")

        except TimeoutException:
            log.error("TimeoutException! No job cards found.")

    def close_pop_ups(self):
        try:
            # Close "Not interested" pop-up if present
            not_interested_button = self.browser.find_elements(By.XPATH, "//button[contains(@aria-label, 'Dismiss')]")
            if not_interested_button:
                not_interested_button[0].click()
                log.info("Closed 'Not interested' pop-up")
                time.sleep(1)
            
            # Close any other potential pop-ups or overlays
            overlay = self.browser.find_elements(By.XPATH, "//div[contains(@class, 'artdeco-modal-overlay')]")
            if overlay:
                close_button = self.browser.find_elements(By.XPATH, "//button[contains(@aria-label, 'Dismiss')]")
                if close_button:
                    close_button[0].click()
                    log.info("Closed overlay pop-up")
                    time.sleep(1)
        
        except Exception as e:
            log.warning(f"Error while trying to close pop-ups: {e}")

    def is_already_applied(self):
        try:
            applied_status = self.browser.find_element(By.XPATH, "//span[contains(@class, 'artdeco-inline-feedback__message') and contains(text(), 'Applied')]")
            if applied_status:
                log.info("Already applied to this job")
                return True
        except NoSuchElementException:
            return False
        return False

    def click_easy_apply(self):
        try:
            easy_apply_button = self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(@aria-label, 'Easy Apply to')]")))
            easy_apply_button.click()
            log.info("Clicked Easy Apply button")
            return True
        except TimeoutException:
            log.warning("Easy Apply button not found")
            return False

    def handle_application_process(self):
        try:
            self.click_continue_applying()
            
            while True:
                if not self.wait_for_form_elements(timeout=10):
                    log.warning("No new form elements loaded")
                    break
                
                form = self.browser.find_element(By.TAG_NAME, "form")
                self.parse_and_fill_form(form)
                
                # Check if there's a resume upload option
                upload_button = self.browser.find_elements(By.XPATH, "//label[contains(@class, 'jobs-document-upload__upload-button')]")
                if upload_button:
                    self.upload_resume()
                
                if not self.click_next_or_submit():
                    break
            
            self.handle_confirmation()
            
        except Exception as e:
            log.error(f"Error in application process: {e}")

    def click_continue_applying(self):
        try:
            continue_applying_button = WebDriverWait(self.browser, 5).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(@aria-label, 'Continue applying') or contains(text(), 'Continue applying')]"))
            )
            continue_applying_button.click()
            log.info("Clicked 'Continue applying' button")
        except TimeoutException:
            log.info("No 'Continue applying' button found, proceeding with application")

    def wait_for_form_elements(self, timeout=30):
        try:
            WebDriverWait(self.browser, timeout).until(
                EC.presence_of_element_located((By.XPATH, "//form//input | //form//select | //form//textarea"))
            )
            WebDriverWait(self.browser, timeout).until_not(
                EC.presence_of_element_located((By.XPATH, "//div[contains(@class, 'loading-spinner')]"))
            )
            return True
        except TimeoutException:
            log.error("Form elements did not load within the expected time")
            return False

    def parse_and_fill_form(self, form):
        try:
            input_fields = form.find_elements(By.TAG_NAME, "input")
            select_fields = form.find_elements(By.TAG_NAME, "select")
            textarea_fields = form.find_elements(By.TAG_NAME, "textarea")
            fieldset_elements = form.find_elements(By.TAG_NAME, "fieldset")

            for fieldset in fieldset_elements:
                time.sleep(2)
                self.handle_radio_button_group(fieldset)
                time.sleep(2)

            for field in input_fields:
                field_type = field.get_attribute("type")
                field_id = field.get_attribute("id")
                label = self.find_label_for_field(field)

                if field_type in ["text", "email", "tel"]:
                    value = self.get_best_match_value(label)
                    if value:
                        self.handle_input_field(field, value)
                    elif "city" in field_id.lower():
                        value = self.resume_data.get("city", "New York")
                        self.handle_input_field(field, value)
                    else:
                        self.handle_input_field(field, "Default Value")
                elif field_type == "number":
                    value = self.get_best_match_value(label)
                    if value and value.isdigit():
                        self.handle_input_field(field, value)
                    elif label and "year" in label.lower():
                        self.handle_input_field(field, str(random.randint(1, 10)))
                    else:
                        self.handle_input_field(field, "2")
                elif field_type in ["checkbox", "radio"]:
                    if label and ("agree" in label.lower() or "terms" in label.lower() or "conditions" in label.lower()):
                        self.safe_click(field)
                    else:
                        value = self.get_best_match_value(label)
                        if value and value.lower() == "yes":
                            self.safe_click(field)

            for field in select_fields:
                select = Select(field)
                options = select.options
                if len(options) > 1:
                    label = self.find_label_for_field(field)
                    value = self.get_best_match_value(label)
                    if value:
                        best_option = max(options, key=lambda option: fuzz.ratio(option.text.lower(), value.lower()))
                        select.select_by_visible_text(best_option.text)
                    else:
                        select.select_by_index(random.randint(1, len(options) - 1))

            for field in textarea_fields:
                label = self.find_label_for_field(field)
                value = self.get_best_match_value(label)
                if value:
                    self.safe_send_keys(field, value)
                else:
                    self.safe_send_keys(field, "This is a default text for all textarea fields.")

            log.info("Form filled successfully")
        except Exception as e:
            log.error(f"Error filling form: {e}")

    def handle_radio_button_group(self, fieldset):
        try:
            legend = fieldset.find_element(By.TAG_NAME, "legend")
            question = legend.text.strip()
            log.info(f"Handling radio button group: {question}")

            options = fieldset.find_elements(By.XPATH, ".//input[@type='radio']")
            labels = fieldset.find_elements(By.XPATH, ".//label")

            # Check if any option is already selected
            selected_option = fieldset.find_elements(By.XPATH, ".//input[@type='radio' and @checked]")
            if selected_option:
                selected_label = self.find_label_for_field(selected_option[0])
                log.info(f"Option already selected: {selected_label}")
                return

            best_match_value = self.get_best_match_value(question)
            
            if best_match_value:
                for option, label in zip(options, labels):
                    if label.text.strip().lower() == best_match_value.lower():
                        self.safe_click(option, wait_time=10)
                        log.info(f"Selected option: {label.text}")
                        return
            
            # If no match found, select "Yes" if it's an option, otherwise select the first option
            for option, label in zip(options, labels):
                if label.text.strip().lower() == "yes":
                    self.safe_click(option, wait_time=10)
                    log.info("Selected 'Yes' option as default")
                    return
            
            # If "Yes" is not an option, select the first option
            if options:
                self.safe_click(options[0], wait_time=10)
                log.info(f"Selected first option: {labels[0].text}")

        except Exception as e:
            log.error(f"Error handling radio button group: {e}")

    def safe_send_keys(self, element, value):
        try:
            self.wait.until(EC.element_to_be_clickable(element))
            element.clear()
            element.send_keys(value)
        except Exception as e:
            log.warning(f"Failed to send keys to element: {e}")

    def safe_click(self, element, label=None, wait_time=5):
        try:
            if label:
                label_element = self.browser.find_element(By.XPATH, f"//label[contains(text(), '{label}')]")
                self.wait.until(EC.element_to_be_clickable(label_element))
                self.browser.execute_script("arguments[0].click();", label_element)
            else:
                WebDriverWait(self.browser, wait_time).until(EC.element_to_be_clickable(element))
                self.browser.execute_script("arguments[0].click();", element)
            time.sleep(1)  # Add a small delay after clicking
            log.info(f"Successfully clicked element: {label or element}")
        except Exception as e:
            log.warning(f"Failed to click element: {e}")
            # Try an alternative method
            try:
                self.browser.execute_script("arguments[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))", element)
                log.info("Used alternative click method")
            except Exception as e2:
                log.error(f"Alternative click method also failed: {e2}")

    def find_label_for_field(self, field):
        field_id = field.get_attribute("id")
        if field_id:
            try:
                label = self.browser.find_element(By.XPATH, f"//label[@for='{field_id}']")
                return label.text.strip()
            except NoSuchElementException:
                pass

        try:
            parent = field.find_element(By.XPATH, "..")
            label = parent.find_element(By.TAG_NAME, "label")
            return label.text.strip()
        except NoSuchElementException:
            return None

    def get_best_match_value(self, label):
        if not label:
            return None

        best_match = None
        best_ratio = 0

        for key, value in self.resume_data.items():
            ratio = fuzz.token_set_ratio(key.lower(), label.lower())
            if ratio > best_ratio:
                best_ratio = ratio
                best_match = value

        log.info(f"Best match for '{label}': {best_match} (ratio: {best_ratio})")
        return best_match if best_ratio > 70 else None

    def handle_input_field(self, field, value):
        try:
            self.safe_send_keys(field, value)
            time.sleep(1)  # Wait for autocomplete to populate

            # Check if the field has autocomplete functionality
            if field.get_attribute("role") == "combobox" and field.get_attribute("aria-autocomplete") == "list":
                self.handle_autocomplete(field, value)
            else:
                # If no autocomplete, just send an Enter key to confirm the input
                field.send_keys(Keys.ENTER)

        except Exception as e:
            log.warning(f"Failed to handle input field: {e}")

    def handle_autocomplete(self, field, value):
        try:
            # Wait for the autocomplete list to appear
            WebDriverWait(self.browser, 5).until(
                EC.presence_of_element_located((By.XPATH, "//ul[@role='listbox']/li"))
            )

            # Find all autocomplete options
            options = self.browser.find_elements(By.XPATH, "//ul[@role='listbox']/li")

            if options:
                # Find the closest match
                best_match = max(options, key=lambda option: fuzz.ratio(option.text.lower(), value.lower()))
                
                # Click the best match
                self.safe_click(best_match)
            else:
                # If no options found, just confirm the input
                field.send_keys(Keys.ENTER)

        except TimeoutException:
            # If autocomplete list doesn't appear, just confirm the input
            field.send_keys(Keys.ENTER)
        except Exception as e:
            log.warning(f"Failed to handle autocomplete: {e}")

    def click_next_or_submit(self):
        try:
            self.browser.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)

            button_xpath = "//button[contains(text(), 'Next') or contains(text(), 'Continue') or contains(text(), 'Review') or contains(text(), 'Submit') or contains(text(), 'Apply') or contains(@aria-label, 'Continue to next step') or contains(@aria-label, 'Review your application') or contains(@aria-label, 'Submit application')]"
            
            button = WebDriverWait(self.browser, 10).until(
                EC.element_to_be_clickable((By.XPATH, button_xpath))
            )
            
            self.browser.execute_script("arguments[0].scrollIntoView(true);", button)
            time.sleep(1)
            
            button_text = button.text.lower()
            if 'review' in button_text:
                log.info("Clicked 'Review' button")
            elif 'submit' in button_text or 'apply' in button_text:
                log.info("Clicked 'Submit' button")
                self.safe_click(button)
                return False
            else:
                log.info("Clicked 'Next' button")
            
            self.safe_click(button)
            return True

        except (TimeoutException, ElementClickInterceptedException):
            log.error("Could not find 'Next', 'Review', or 'Submit' button")
            return False

    def handle_confirmation(self):
        try:
            # Wait for the confirmation message
            confirmation = WebDriverWait(self.browser, 10).until(
                EC.presence_of_element_located((By.XPATH, "//h3[contains(text(), 'Your application was sent')]"))
            )
            log.info("Application confirmation received")
            
            # Try to close the confirmation modal using various methods
            dismiss_methods = [
                self.dismiss_by_aria_label,
                self.dismiss_by_id,
                self.dismiss_by_javascript
            ]
            
            for method in dismiss_methods:
                if method():
                    log.info(f"Closed confirmation modal using {method.__name__}")
                    break
            else:
                log.warning("Could not close the confirmation modal")

            # Wait for the modal to disappear
            WebDriverWait(self.browser, 10).until(
                EC.invisibility_of_element_located((By.XPATH, "//div[contains(@class, 'artdeco-modal-overlay')]"))
            )
            log.info("Confirmation modal closed")

        except TimeoutException:
            log.warning("Confirmation message or dismiss button not found")

    def dismiss_by_aria_label(self):
        try:
            dismiss_button = WebDriverWait(self.browser, 5).until(
                EC.element_to_be_clickable((By.XPATH, "//button[@aria-label='Dismiss']"))
            )
            self.safe_click(dismiss_button)
            return True
        except TimeoutException:
            return False

    def dismiss_by_id(self):
        try:
            dismiss_button = WebDriverWait(self.browser, 5).until(
                EC.element_to_be_clickable((By.ID, "ember1456"))
            )
            self.safe_click(dismiss_button)
            return True
        except TimeoutException:
            return False

    def dismiss_by_javascript(self):
        try:
            self.browser.execute_script("""
                const button = document.querySelector('button[aria-label="Dismiss"]');
                if (button) {
                    button.click();
                    return true;
                }
                return false;
            """)
            return True
        except Exception:
            return False

    def upload_resume(self):
        try:
            upload_button = self.wait.until(EC.presence_of_element_located((By.XPATH, "//label[contains(@class, 'jobs-document-upload__upload-button')]")))
            
            input_id = upload_button.get_attribute("for")
            file_input = self.browser.find_element(By.ID, input_id)
            
            file_input.send_keys(self.resume_path)
            
            self.wait.until(EC.presence_of_element_located((By.XPATH, "//div[contains(@class, 'jobs-document-upload__uploaded-item')]")))
            
            log.info(f"Resume uploaded successfully: {self.resume_path}")
        except Exception as e:
            log.error(f"Error uploading resume: {e}")

    def run_job_application_process(self, job_title: str, location: str):
        self.start_linkedin()
        self.search_jobs(job_title, location)



if __name__ == '__main__':
    username = "email"
    password = "pass"
    
    resume_data = {
        "first name": "Shine",
        "last name": "Gupta",
        "email": "guptashine5002@gmail.com",
        "phone country code": "India (+91)",
        "mobile phone number": "8433135192",
        "city": "New York",
        "years of experience": "5",
        "highest degree": "Bachelor's",
        "field of study": "Computer Science",
        "skills": "Python, Data Analysis, Machine Learning, SQL, Data Visualization",
        "about me": "Experienced data scientist with a passion for solving complex problems using advanced analytics and machine learning techniques. Proficient in Python, SQL, and various data visualization tools.",
        "current job title": "Data Scientist",
        "current company": "TechCorp Inc.",
        "work authorization": "Authorized to work in the US",
        "preferred job type": "Full-time",
        "preferred work setting": "Remote",
        "salary expectation": "Competitive",
        "willing to relocate": "Yes",
        "linkedin profile": "https://www.linkedin.com/in/shine-gupta-62b22b264/",
        "github profile": "https://github.com/Shine-5705",
        "personal website": "https://shine-5705.github.io/",
        "references": "Available upon request"
    }
    job_title = "Data Science"
    location = "United States"

    job_filters = {
        "easy_apply": True,
        "experience_level": "Internship",
        "work_type": "Remote"
    }

    resume_path = "Resume__Anonymous_best.pdf"  # Replace with the actual path to the resume file

    bot = LinkedInLoginBot(username, password, resume_data, job_filters, resume_path)
    bot.run_job_application_process(job_title, location)