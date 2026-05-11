"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import YouTube, {
  type YouTubeEvent,
  type YouTubePlayer as YTPlayer,
} from "react-youtube";

export interface YouTubePlayerHandle {
  /** Seek to ``seconds`` and start playback. */
  seekTo: (seconds: number) => void;
  /** Returns current playback position in seconds. */
  getCurrentTime: () => number;
}

interface Props {
  videoId: string;
}

const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(
  function YouTubePlayer({ videoId }, ref) {
    const playerRef = useRef<YTPlayer | null>(null);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (!playerRef.current) return;
        playerRef.current.seekTo(seconds, true);
        playerRef.current.playVideo();
      },
      getCurrentTime: () => {
        if (!playerRef.current) return 0;
        return playerRef.current.getCurrentTime() ?? 0;
      },
    }));

    return (
      <div
        className="relative w-full aspect-video bg-black rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.06)" }}
      >
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