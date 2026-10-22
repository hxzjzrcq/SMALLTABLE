# Media fixture

`tone.mp3`: generated locally with FFmpeg's sine source, 440 Hz, 8 seconds, mono,
44.1 kHz, MPEG Layer III at 64 kbit/s; ID3v2.3 tag, no Xing header. Synthetic tone,
no third-party recording. Runtime does not invoke FFmpeg.

Regenerate: `ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100 -t 8 -c:a libmp3lame -b:a 64k -write_xing 0 -id3v2_version 3 tone.mp3`

`tone-long.mp3`: same method, 660 Hz, 24 seconds. Used to keep playback active during multi-client checks. No third-party audio.
