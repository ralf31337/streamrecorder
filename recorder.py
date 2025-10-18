#!/usr/bin/env python3
"""
SATIP Stream Recorder
Records SATIP streams to MP3 files using ffmpeg with configurable duration.
"""

import os
import sys
import subprocess
import logging
from datetime import datetime
from pathlib import Path
import argparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_timestamp(timezone):
    """Generate timestamp in local timezone."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(timezone)
    except ImportError:
        logger.warning("zoneinfo not available, falling back to pytz")
        try:
            import pytz
            tz = pytz.timezone(timezone)
        except ImportError:
            logger.error("Neither zoneinfo nor pytz available. Install pytz or use Python 3.9+")
            sys.exit(1)
    
    now = datetime.now(tz)
    return now.strftime("%Y%m%d_%H%M%S")


def record_stream(stream_url, duration_minutes, file_prefix, output_dir, timezone):
    """
    Record stream to MP3 file.
    
    Args:
        stream_url: SATIP stream URL
        duration_minutes: Duration to record in minutes
        file_prefix: Prefix for output filename
        output_dir: Directory to save recording
        timezone: Timezone for timestamp
    """
    # Create output directory if it doesn't exist
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate filename with timestamp
    timestamp = get_timestamp(timezone)
    output_file = output_dir / f"{file_prefix}_{timestamp}.mp3"
    
    logger.info(f"Starting recording...")
    logger.info(f"Stream URL: {stream_url}")
    logger.info(f"Duration: {duration_minutes} minutes")
    logger.info(f"Output file: {output_file}")
    
    # Calculate duration in seconds
    duration_seconds = duration_minutes * 60
    
    # Build ffmpeg command
    ffmpeg_cmd = [
        "ffmpeg",
        "-re",
        "-i", stream_url,
        "-t", str(duration_seconds),  # Duration limit
        "-vn",  # No video
        "-acodec", "libmp3lame",
        "-ar", "48000",  # Audio sample rate
        "-b:a", "192k",  # Audio bitrate
        "-f", "mp3",
        str(output_file)
    ]
    
    try:
        # Run ffmpeg
        process = subprocess.run(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True
        )
        
        logger.info(f"Recording completed successfully!")
        logger.info(f"File saved: {output_file}")
        
        # Check if file exists and has content
        if output_file.exists():
            file_size = output_file.stat().st_size
            logger.info(f"File size: {file_size / 1024 / 1024:.2f} MB")
            
            # Create symlink for latest recording
            symlink_path = output_dir / f"{file_prefix}.mp3"
            try:
                # Remove existing symlink if it exists
                if symlink_path.exists() or symlink_path.is_symlink():
                    symlink_path.unlink()
                # Create new symlink pointing to the new recording
                symlink_path.symlink_to(output_file.name)
                logger.info(f"Symlink created: {symlink_path} -> {output_file.name}")
            except Exception as e:
                logger.warning(f"Could not create symlink: {e}")
                # Don't fail the recording if symlink creation fails
        else:
            logger.error("Output file was not created!")
            sys.exit(1)
            
    except subprocess.CalledProcessError as e:
        logger.error(f"ffmpeg failed with error code {e.returncode}")
        logger.error(f"stderr: {e.stderr.decode('utf-8', errors='ignore')}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Record SATIP stream to MP3 file',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Record for 60 minutes with prefix "morning_show"
  python recorder.py 60 morning_show
  
  # Record with custom stream URL
  python recorder.py 120 evening_show --stream-url "http://..."
  
  # Override timezone
  python recorder.py 30 test --timezone "Europe/Berlin"
        """
    )
    
    parser.add_argument(
        'duration',
        type=int,
        help='Recording duration in minutes'
    )
    
    parser.add_argument(
        'prefix',
        type=str,
        help='Filename prefix for the recording'
    )
    
    parser.add_argument(
        '--stream-url',
        type=str,
        default=None,
        help='SATIP stream URL (default: from STREAM_URL env var)'
    )
    
    parser.add_argument(
        '--output-dir',
        type=str,
        default='/recordings',
        help='Output directory for recordings (default: /recordings)'
    )
    
    parser.add_argument(
        '--timezone',
        type=str,
        default=None,
        help='Timezone for timestamp (default: from TIMEZONE env var or Europe/Vienna)'
    )
    
    args = parser.parse_args()
    
    # Get stream URL from args or environment
    stream_url = args.stream_url or os.getenv('STREAM_URL')
    if not stream_url:
        logger.error("Stream URL not provided. Use --stream-url or set STREAM_URL environment variable.")
        sys.exit(1)
    
    # Get timezone from args or environment
    timezone = args.timezone or os.getenv('TIMEZONE', 'Europe/Vienna')
    
    # Validate duration
    if args.duration <= 0:
        logger.error("Duration must be greater than 0")
        sys.exit(1)
    
    # Validate prefix
    if not args.prefix or '/' in args.prefix:
        logger.error("Invalid prefix. Must not contain '/' character.")
        sys.exit(1)
    
    # Start recording
    record_stream(
        stream_url=stream_url,
        duration_minutes=args.duration,
        file_prefix=args.prefix,
        output_dir=args.output_dir,
        timezone=timezone
    )


if __name__ == '__main__':
    main()

