# Pull base image.
FROM debian:bookworm-slim AS base

WORKDIR /opt/beezeelinx

ARG DEBIAN_FRONTEND=noninteractive

RUN \
    apt-get -qq update && \
    apt-get install -yq --no-install-recommends \
        software-properties-common \
        curl \
        gnupg \
        git \
    && \
    apt-get clean && \
    apt-get autoremove && \
    rm -rf /var/lib/apt/lists/*


ENV PATH=$PATH:/usr/local/go/bin

RUN curl -sS https://dl.google.com/go/go1.24.0.linux-amd64.tar.gz -o go1.24.0.linux-amd64.tar.gz && \
    rm -rf /usr/local/go && tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz

# Install latest node 18.x without dev dependencies

RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n && \
    bash n 18 && \
    rm -f n

# Create ubuntu user

RUN adduser --disabled-password --gecos '' beezeelinx && adduser beezeelinx sudo && echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown beezeelinx $PWD && \
    rm /bin/sh && ln -sf /bin/bash /bin/sh

################################################

FROM base AS builder

WORKDIR /opt/beezeelinx

# Update npm

RUN npm i -g npm@9

# Starting from now, run everything as beezeelinx user

USER beezeelinx

RUN mkdir -p bzl-licenses-checker
COPY --chown=beezeelinx:beezeelinx package*.json bzl-licenses-checker/
RUN cd bzl-licenses-checker && npm install

# COPY GIT repos locally

COPY --chown=beezeelinx:beezeelinx ./ bzl-licenses-checker/

RUN rm -rf bzl-licenses-checker/.git*

# Build license detector

RUN git clone https://github.com/go-enry/go-license-detector.git && \
    cd go-license-detector/cmd/license-detector && go build

FROM base
LABEL maintainer="BeeZeeLinx"
LABEL description="BeeZeeLinx Licenses Checker"

COPY --from=builder /opt/beezeelinx/go-license-detector/cmd/license-detector/license-detector /usr/bin/

WORKDIR /opt/beezeelinx/bzl-licenses-checker
USER beezeelinx

STOPSIGNAL SIGKILL

COPY --chown=beezeelinx:beezeelinx --from=builder /opt/beezeelinx/bzl-licenses-checker/ /opt/beezeelinx/bzl-licenses-checker/

ENV GITURL=""
ENV GOPRIVATE github.com/beezeelinx
ENTRYPOINT [ "/opt/beezeelinx/bzl-licenses-checker/start.sh" ]
