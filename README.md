Visit **[xiangtaoxu.eeb.cornell.edu](https://xiangtaoxu.eeb.cornell.edu)** 🚀


## TL;DR guideline of updating website

### 0. Direct update on github
You can add new files, e.g. create a new post markdown file, upload a new image, etc., or editing existing files directly on github with your browser.

For adding a new file, go to the folder you are editing/updating, click the `Add file` button on the upper right corner of the repo.

For updating an existing file, open the the file and directly update.

Each action will automatically create a git commit.

### 1. Update on your local machine (recommended)
This approach can combine multiple updates into a single commit and help you to practice git/Github operations.

#### 1.0 First-time user
Please set up git on your local computer. Instructions can be found [HERE](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)

Then clone the repo on your local machine

`git clone git@github.com:BioM2-Lab/xiangtaoxu.github.io.git`

#### 1.1 General updating workflow with git

##### 1.1.1 Always pull the most updated version from Github
`git pull origin main`

##### 1.1.2 Make modifications

Please refer the official documentation of the Lab Website Template below for details

[**Documentation**](https://greene-lab.gitbook.io/lab-website-template-docs)

##### 1.1.3 Commit your changes
For add new files or update existing files

`git add [filename(s)]`

For removing files folders

`git rm filename(s)`

`git rm -r foldername(s)`

Then `git commit -m "[short sentences summarizing the commit]"`

##### 1.1.4 (optional) Preview your changes

For organization-owned pages, we have to preview locally, please refer to the Documentation in **1.1.2** to set up local preview with docker

#### 1.2 Push your changes to Github
`git push origin main`

### 2. Create pull request
No matter you make updates on Github directly or locally and then push the commits, you need to create a pull request at [THIS REPO](https://github.com/xiangtaoxu/xiangtaoxu.github.io)

Click `Pull requests` on top of the repo and then click the green button on the upper right `New pull request`

Select `compare across forks` and make sure you change the head repository to below

![example](/images/misc/pr_example.png)

And then create the pull request.
