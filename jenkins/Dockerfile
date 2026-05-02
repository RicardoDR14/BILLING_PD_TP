FROM jenkins/jenkins:lts
USER root

# Install Docker CLI, Ansible, pip and sudo
RUN apt-get update && \
    apt-get install -y docker.io ansible python3-pip sudo && \
    rm -rf /var/lib/apt/lists/*

# Allow jenkins to run sudo without a password (needed by ansible become: true)
RUN echo "jenkins ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Pre-install the Docker Python SDK so Ansible community.docker modules work locally
RUN pip3 install docker --break-system-packages

# Add jenkins user to docker group so it can run docker commands
RUN usermod -aG docker jenkins

USER jenkins
