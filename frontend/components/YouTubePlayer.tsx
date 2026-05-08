"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import YouTube, {
  type YouTubeEvent,
  type YouTubePlayer as YTPlayer,
} from "react-youtube";

export interface YouTubePlayerHandle {
  /** Seek to ``seconds`` and start playback. */
  seekTo: (seconds: number) => void;
}

interface Props {
  videoId: string;
}

/**
 * Thin wrapper around the YouTube IFrame Player API. The parent grabs an
 * imperative handle via ``ref`` and calls ``seekTo(seconds)`` from anywhere
 * in the dashboard (outline rows, flashcards, search hits, etc.).
 */
const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(
  function YouTubePlayer({ videoId }, ref) {
    const playerRef = useRef<YTPlayer | null>(null);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (!playerRef.current) return;
        playerRef.current.seekTo(seconds, true);
        playerRef.current.playVideo();
      },
    }));

    return (
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
        <YouTube
          videoId={videoId}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { rel: 0, modestbranding: 1 },
          }}
          onReady={(e: YouTubeEvent) => {
            playerRef.current = e.target;
          }}
          className="absolute inset-0"
          iframeClassName="w-full h-full"
        />
      </div>
    );
  },
);

export default YouTubePlayer;
