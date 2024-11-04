# Autonomous_LinkedIn

A Python-based automation tool that helps streamline your job application process on LinkedIn using Selenium WebDriver. This bot automatically fills out job applications using your resume data and custom filters.

## Features

- Automated LinkedIn login
- Custom job search with filters
  - Location-based search
  - Experience level filtering
  - Work type filtering (Remote, On-site, Hybrid)
  - Easy Apply filter
- Intelligent form filling based on resume data
- Automatic resume upload
- Smart handling of various application forms
  - Text inputs
  - Select dropdowns
  - Radio buttons
  - Checkboxes
  - Text areas
- Fuzzy matching for accurate form field completion
- Comprehensive logging system
- Automatic handling of pop-ups and overlays

## Prerequisites

- Python 3.7+
- Chrome browser
- Active LinkedIn account
- Resume in PDF format

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/Autonomous_LinkedIn.git
cd Autonomous_LinkedIn
```

2. Install required packages:
```bash
pip install selenium webdriver_manager fuzzywuzzy python-Levenshtein
```

## Configuration

1. Create a copy of your resume data in the following format:
```python
resume_data = {
    "first name": "Your First Name",
    "last name": "Your Last Name",
    "email": "your.email@example.com",
    "phone country code": "Your Country Code",
    "mobile phone number": "Your Phone Number",
    "city": "Your City",
    "years of experience": "Your Experience",
    "highest degree": "Your Degree",
    "field of study": "Your Field",
    "skills": "Your Skills",
    "about me": "Your Description",
    # ... add other relevant fields
}
```

2. Set up your job search filters:
```python
job_filters = {
    "easy_apply": True,
    "experience_level": "Internship",  # Options: "Internship", "Entry level", "Associate", "Mid-Senior level", "Director", "Executive"
    "work_type": "Remote"  # Options: "Remote", "On-site", "Hybrid"
}
```

## Usage

1. Update the main script with your credentials and preferences:
```python
username = "your_email@example.com"
password = "your_password"
job_title = "Your Target Job Title"
location = "Your Target Location"
resume_path = "path/to/your/resume.pdf"
```

2. Run the script:
```bash
python linkedin_bot.py
```

## Safety Features

- Built-in delays to prevent detection
- Random timing between actions
- Browser automation hiding
- Popup and overlay handling
- Error recovery mechanisms
- Comprehensive logging

## Logging

The bot includes detailed logging of all actions and errors. Logs include:
- Login attempts
- Job search results
- Form filling progress
- Application submissions
- Errors and exceptions

## Best Practices

1. **Rate Limiting**: Don't apply to too many jobs too quickly to avoid account restrictions
2. **Resume Format**: Ensure your resume is in PDF format
3. **Data Accuracy**: Keep your resume_data dictionary up-to-date
4. **Monitoring**: Regular monitoring of the bot's operation is recommended

## Known Limitations

- Only works with "Easy Apply" applications
- Some complex application forms may require manual intervention
- LinkedIn's interface changes may require updates to selectors
- Cannot handle CAPTCHA challenges

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Legal Disclaimer

This bot is for educational purposes only. Use of automation tools may be against LinkedIn's terms of service. Use at your own risk.


## Support

If you encounter any issues or have questions, please:
1. Check the existing issues on GitHub
2. Create a new issue with a detailed description and steps to reproduce

## Acknowledgments

- Selenium WebDriver team
- FuzzyWuzzy for string matching
- All contributors to this project
