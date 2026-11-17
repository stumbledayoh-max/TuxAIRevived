#!/bin/bash
# Instala JDK 17 + Android SDK (build-tools 34) em ~/build (fora do snapshot, por ser pesado)
set -e
BASE="$HOME/build"
mkdir -p "$BASE"
if [ ! -x "$BASE/jdk17/bin/java" ]; then
  echo ">> Baixando JDK 17..."
  curl -sL -o /tmp/jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p "$BASE/jdk17" && tar -xzf /tmp/jdk.tar.gz -C "$BASE/jdk17" --strip-components=1 && rm /tmp/jdk.tar.gz
fi
export JAVA_HOME="$BASE/jdk17" ANDROID_HOME="$BASE/android-sdk" PATH="$JAVA_HOME/bin:$PATH"
if [ ! -f "$ANDROID_HOME/platforms/android-34/android.jar" ] || [ ! -x "$ANDROID_HOME/build-tools/34.0.0/aapt2" ]; then
  echo ">> Baixando Android SDK..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl -sL -o /tmp/cmd.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  cd /tmp && unzip -q -o cmd.zip -d "$ANDROID_HOME/cmdline-tools" && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" && rm /tmp/cmd.zip
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "build-tools;34.0.0" "platforms;android-34"
fi
echo ">> Toolchain pronto: $ANDROID_HOME"
