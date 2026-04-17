/**
 * Type declarations for experimental Media Session and Audio APIs
 * 
 * These extend the standard TypeScript lib.dom.d.ts definitions with
 * experimental features not yet in the baseline.
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/MediaMetadata/chapterInfo
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioSession
 */

// ============================================================================
// Media Session - ChapterInformation (Chrome 127+)
// ============================================================================

/**
 * Represents metadata for an individual chapter of a media resource.
 * Used to provide chapter navigation on lock screens and media controls.
 */
interface ChapterInformation {
  /** The title of the chapter */
  title: string
  /** The start time of the chapter in seconds */
  startTime: number
  /** Optional artwork images associated with the chapter */
  artwork?: MediaImage[]
}

/**
 * Extend MediaMetadataInit to include chapterInfo
 */
interface MediaMetadataInit {
  title?: string
  artist?: string
  album?: string
  artwork?: MediaImage[]
  /** Chapter information for audiobooks and long-form content */
  chapterInfo?: ChapterInformation[]
}

// ============================================================================
// Audio Session API (iOS 16+, Firefox 17.6+)
// ============================================================================

/**
 * Audio session types that describe how audio should interact with other audio.
 */
type AudioSessionType = 
  | 'auto'           // Let the browser decide
  | 'playback'       // Media playback (music, audiobooks) - bypasses silent switch
  | 'transient'      // Short notification sounds
  | 'transient-solo' // Notification that pauses other audio
  | 'ambient'        // Background audio that mixes with others
  | 'play-and-record' // For video calls and recording

/**
 * The AudioSession interface allows control over how audio interacts
 * with other audio sources on the device.
 */
interface AudioSession {
  /** The current audio session type */
  type: AudioSessionType
}

/**
 * Extend Navigator to include audioSession
 */
interface Navigator {
  /** 
   * Audio Session API for controlling audio behavior on iOS and other platforms.
   * @experimental Not available in all browsers
   */
  readonly audioSession?: AudioSession
}

// ============================================================================
// Screen Wake Lock API (Chrome 84+, Safari 16.4+)
// Already in lib.dom.d.ts but adding for completeness
// ============================================================================

// WakeLock and WakeLockSentinel are already defined in lib.dom.d.ts
// Just ensuring Navigator.wakeLock is properly typed
interface Navigator {
  readonly wakeLock?: WakeLock
}
