#!/bin/sh
# backup.sh - SQLite database backup script with OpenTelemetry instrumentation

# Create a state directory to track last runs
STATE_DIR="/tmp/backup-state"
mkdir -p ${STATE_DIR}
mkdir -p ${BACKUP_DIR}

echo "Database backup service started"
echo "Using OpenTelemetry endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}"
echo "Service name: ${OTEL_SERVICE_NAME}"
echo "Backup schedule: ${BACKUP_SCHEDULE}"
echo "Backup retention in days: ${BACKUP_RETENTION}"

# The backup function remains the same as in your previous script
perform_backup() {
  # Same as before - your original backup implementation
  # Generate timestamp for this backup run
  TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/sqlite-${TIMESTAMP}.db"

  echo "Starting backup process at $(date) for schedule: $SCHEDULE_SPEC"

  # Start a parent span for the entire backup process
  otel-cli exec --service ${OTEL_SERVICE_NAME} --name "database_backup_process" --kind internal -- sh -c "
    echo \"Parent span: Starting database backup process\"
    
    # Count existing backups before process
    BACKUPS_BEFORE=\$(find ${BACKUP_DIR} -name \"sqlite-*.db\" | wc -l)
    echo \"Found \$BACKUPS_BEFORE existing backups\"
    
    # STEP 1: Create backup (child span)
    otel-cli exec --service ${OTEL_SERVICE_NAME} --name \"backup_creation\" --kind internal -- sh -c \"
      echo \\\"Creating backup: ${BACKUP_FILE}\\\"
      
      if sqlite3 ${DATABASE_URL} \\\".backup ${BACKUP_FILE}\\\"; then
        # Get backup file size
        FILE_SIZE=\\\$(stat -c %s \\\"${BACKUP_FILE}\\\")
        echo \\\"Backup created successfully. Size: \\\${FILE_SIZE} bytes\\\"
        
        # Add an event to the span with the file size
        otel-cli span event --name \\\"backup_created\\\" --attrs \\\"file_size=\\\${FILE_SIZE},success=true\\\"
        exit 0
      else
        echo \\\"Backup creation failed\\\"
        
        # Add a failure event to the span
        otel-cli span event --name \\\"backup_failed\\\" --attrs \\\"success=false\\\"
        exit 1
      fi
    \"
    
    BACKUP_RESULT=\$?
    
    if [ \$BACKUP_RESULT -ne 0 ]; then
      echo \"Backup creation failed, aborting process\"
      exit \$BACKUP_RESULT
    fi
    
    # Get backup file size after successful creation
    FILE_SIZE=\$(stat -c %s \"${BACKUP_FILE}\")
    
    # STEP 2: Clean up old backups (child span)
    otel-cli exec --service ${OTEL_SERVICE_NAME} --name \"backup_cleanup\" --kind internal \
      --attr \"backups_before=\${BACKUPS_BEFORE}\" \
      --attr \"retention_days=${BACKUP_RETENTION}\" \
      -- sh -c \"
        echo \\\"Cleaning up old backups...\\\"
        
        # Find old backups to delete
        OLD_BACKUPS=\\\$(find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" -type f -mtime +${BACKUP_RETENTION} | wc -l)
        echo \\\"Found \\\${OLD_BACKUPS} backups older than ${BACKUP_RETENTION} days\\\"
        
        # Delete old backups
        find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" -type f -mtime +${BACKUP_RETENTION} -delete
        
        # Count backups after cleanup
        BACKUPS_AFTER=\\\$(find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" | wc -l)
        
        # Calculate total size of all backups
        TOTAL_SIZE=\\\$(du -sb ${BACKUP_DIR} | cut -f1)
        
        echo \\\"Backup cleanup completed: \\\${OLD_BACKUPS} files deleted\\\"
        echo \\\"Backups: \\\${BACKUPS_BEFORE} before, \\\${BACKUPS_AFTER} after cleanup\\\"
        echo \\\"Total backup size: \\\${TOTAL_SIZE} bytes\\\"
        
        # Add an event with the cleanup details
        otel-cli span event --name \\\"cleanup_completed\\\" --attrs \\\"backups_cleaned=\\\${OLD_BACKUPS},backups_after=\\\${BACKUPS_AFTER},total_size=\\\${TOTAL_SIZE}\\\"
      \"
    
    # STEP 3: Create a summary span to capture the overall result
    otel-cli exec --service ${OTEL_SERVICE_NAME} --name \"backup_summary\" --kind internal \
      --attr \"backup_file=${BACKUP_FILE}\" \
      --attr \"file_size=${FILE_SIZE}\" \
      --attr \"success=true\" \
      --attr \"backups_before=${BACKUPS_BEFORE}\" \
      --attr \"backups_after=\$(find ${BACKUP_DIR} -name \"sqlite-*.db\" | wc -l)\" \
      --attr \"total_backup_size=\$(du -sb ${BACKUP_DIR} | cut -f1)\" \
      --attr \"schedule_spec=${SCHEDULE_SPEC}\" \
      -- echo \"Backup process completed successfully at \$(date)\"
  "

  # After successful backup, update the last run time
  echo "$(date +%s)" >"${STATE_DIR}/last_run_${SCHEDULE_HASH}"

  return $?
}

# Main loop
while true; do
  # Get current time information
  current_time=$(date +%H:%M)
  current_timestamp=$(date +%s)

  # Check each schedule spec
  echo "$BACKUP_SCHEDULE" | tr ',' '\n' | while read schedule_spec; do
    # Skip empty lines
    if [ -z "$schedule_spec" ]; then
      continue
    fi

    # Parse the schedule specification
    interval_days=$(echo "$schedule_spec" | cut -d':' -f1)
    schedule_time=$(echo "$schedule_spec" | cut -d':' -f2,3)

    # Create a unique hash for this schedule
    SCHEDULE_HASH=$(echo "$schedule_spec" | md5sum | cut -d' ' -f1)

    # Check if this is a time-based schedule (needs to match current time)
    if [ "$current_time" = "$schedule_time" ]; then
      # For interval-based schedules, check if enough time has passed
      # We use the STATE_DIR to track last run time for each schedule
      last_run_file="${STATE_DIR}/last_run_${SCHEDULE_HASH}"

      # Default to 0 if no previous run
      last_run_time=0
      if [ -f "$last_run_file" ]; then
        last_run_time=$(cat "$last_run_file")
      fi

      # Convert interval_days to seconds
      interval_seconds=$(echo "$interval_days * 86400" | bc)

      # Check if enough time has passed since last run
      time_diff=$((current_timestamp - last_run_time))

      if [ $time_diff -ge $interval_seconds ]; then
        # It's backup time for this schedule!
        echo "Backup triggered for schedule: $schedule_spec"
        SCHEDULE_SPEC="$schedule_spec"
        perform_backup
      else
        # Not enough time has passed since last run
        next_run=$((last_run_time + interval_seconds))
        next_run_date=$(date -d "@$next_run" '+%Y-%m-%d %H:%M:%S')
        echo "Schedule $schedule_spec - Next run at: $next_run_date"
      fi
    fi
  done

  # Sleep for 30 seconds before checking again
  sleep 30
done
