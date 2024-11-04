# Autonomous_LinkedIn

An automated tool built with Python/Node.js that helps streamline the job application process on LinkedIn by automatically filling out Easy Apply applications based on your resume data.

## 🌟 Features

- Automated LinkedIn login and job search
- Supports filtering jobs by:
  - Easy Apply only
  - Experience level
  - Work type (Remote/Hybrid/On-site)
- Smart form filling based on resume data
- Handles various input types:
  - Text fields
  - Select dropdowns
  - Radio buttons
  - Checkboxes
  - File uploads (Resume)
- Intelligent response generation for application questions
- Automatic resume upload
- Robust error handling and retry mechanisms

## 📋 Prerequisites

- Python 3.7+ or Node.js 14+
- Chrome browser installed
- LinkedIn account
- Updated resume file (PDF format recommended)

## 🚀 Installation

### Python Version

1. Clone the repository:
```bash
git clone https://github.com/Shine-5705/Autonomous_LinkedIn.git
cd Autonomous_LinkedIn
```

2. Install required packages:
```bash
pip install selenium webdriver-manager fuzzywuzzy python-Levenshtein logging
```

### Node.js Version

1. Clone the repository:
```bash
git clone https://github.com/Shine-5705/Autonomous_LinkedIn.git
cd Autonomous_LinkedIn
```

2. Install dependencies:
```bash
npm install puppeteer fs path url fuzzysort openai
```

## ⚙️ Configuration

1. Create a configuration object with your credentials and preferences:

```javascript
// For Node.js version
const config = {
    username: "your.email@example.com",
    password: "your_password",
    resumeData: {
        "first name": "Your Name",
        "last name": "Your Last Name",
        "email": "your.email@example.com",
        "phone": "1234567890",
        "location": "City, Country",
        "current title": "Your Title",
        "years of experience": "X",
        "education": "Your Degree",
        "skills": "Skill1, Skill2, Skill3",
        // Add more relevant fields
    },
    jobFilters: {
        easy_apply: true,
        experience_level: "Entry level", // Options: "Internship", "Entry level", "Associate", "Mid-Senior level", "Director", "Executive"
        work_type: "Remote" // Options: "Remote", "On-site", "Hybrid"
    },
    resumePath: "/path/to/your/resume.pdf"
};
```

```python
# For Python version
resume_data = {
    "first name": "Your Name",
    "last name": "Your Last Name",
    "email": "your.email@example.com",
    # Add more fields similar to Node.js version
}

job_filters = {
    "easy_apply": True,
    "experience_level": "Entry level",
    "work_type": "Remote"
}

resume_path = "/path/to/your/resume.pdf"
```

## 🎯 Usage

### Python Version

```python
from linkedin_bot import LinkedInLoginBot

bot = LinkedInLoginBot(
    username="your.email@example.com",
    password="your_password",
    resume_data=resume_data,
    job_filters=job_filters,
    resume_path=resume_path
)

bot.run_job_application_process("Job Title", "Location")
```

### Node.js Version

```javascript
const { LinkedInLoginBot } = require('./linkedin_bot');

const bot = new LinkedInLoginBot(
    config.username,
    config.password,
    config.resumeData,
    config.jobFilters,
    config.resumePath
);

bot.runJobApplicationProcess("Job Title", "Location");
```

## 📝 Important Notes

1. **Resume Format**: Ensure your resume is in a supported format (PDF recommended) and under 2MB.
2. **LinkedIn Rate Limits**: Be mindful of LinkedIn's rate limits and terms of service.
3. **Data Privacy**: Keep your credentials and personal information secure.
4. **Browser Windows**: Don't minimize the browser window while the bot is running.
5. **Application Review**: Always review the applications being submitted by the bot.

## 🔒 Security Considerations

- Never commit your credentials or personal information to version control
- Use environment variables for sensitive information
- Review each application before final submission
- Monitor the bot's activity to ensure it's working as intended

## 🐛 Troubleshooting

Common issues and solutions:

1. **Login Failed**
   - Check your credentials
   - Ensure you're not using 2FA
   - Try logging in manually first

2. **Resume Upload Failed**
   - Verify the resume path is correct
   - Check file size (must be under 2MB)
   - Ensure file format is supported

3. **Form Filling Issues**
   - Update resume_data with more comprehensive information
   - Check console logs for specific field errors
   - Verify field selectors are current

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## ⚖️ License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This bot is for educational purposes only. Use of automated tools may be against LinkedIn's terms of service. Use at your own risk and responsibility.
