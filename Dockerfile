# Backend do Web2APK — é ELE quem compila o APK (precisa de Java + Android SDK).
# A Vercel NÃO roda isso (serverless, sem SDK e com limite de tempo).
# Use este Dockerfile no Render, Railway, Fly.io ou qualquer VPS.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip zip python3 python3-pil openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

# Android SDK: plataforma 34 + build-tools 34 (aapt2, d8, zipalign, apksigner)
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -sL -o /tmp/cmd.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q /tmp/cmd.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/cmd.zip \
 && yes | sdkmanager --licenses >/dev/null 2>&1 || true
RUN sdkmanager "build-tools;34.0.0" "platforms;android-34"

WORKDIR /app
COPY . .
ENV PORT=3000 JOBS_DIR=/tmp/web2apk-jobs
EXPOSE 3000
CMD ["node", "server.js"]
