FROM jenkins/jenkins:lts
USER root

# Install Docker CLI, Ansible and pip
RUN apt-get update && \
    apt-get install -y docker.io ansible python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Add jenkins user to docker group so it can run docker commands
RUN usermod -aG docker jenkins

USER jenkins
