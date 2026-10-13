// Phone camera handling.

let stream = null;
let facing = 'environment';

/** Whether the browser allows camera access at all (needs HTTPS or localhost). */
export function cameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function isRunning() {
  return Boolean(stream);
}

export function currentFacing() {
  return facing;
}

/**
 * Starts the camera preview in a <video> element.
 * @param {HTMLVideoElement} video
 * @param {'environment'|'user'} preferred
 */
export async function startCamera(video, preferred = facing) {
  if (!cameraSupported()) {
    throw new Error('camera.unsupported');
  }
  stopCamera();
  facing = preferred;

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } else {
      throw err;
    }
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  // Wait until the real frame dimensions are known.
  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  return { width: video.videoWidth, height: video.videoHeight };
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

/** Copies the current video frame to a canvas of the given width. */
export function grabFrame(video, targetWidth = 320) {
  if (!video.videoWidth) return null;
  const width = Math.min(targetWidth, video.videoWidth);
  const height = Math.round((video.videoHeight / video.videoWidth) * width);

  const canvas = grabFrame.canvas || (grabFrame.canvas = document.createElement('canvas'));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
