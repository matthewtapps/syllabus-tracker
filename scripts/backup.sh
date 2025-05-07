#!/bin/sh
# backup.sh - SQLite database backup script with OpenTelemetry instrumentation

# Create a minimal state dir for error spans
mkdir -p /tmp/backup-state
STATE_DIR="/tmp/backup-state"

# Function to send error spans
send_error_span() {
  ERROR_MESSAGE="$1"
  ERROR_CODE="${2:-unknown}"
  
  echo "ERROR: ${ERROR_MESSAGE}"
  
  otel-cli span \
    --name "backup_service_error" \
    --kind internal \
    --status-code error \
    --status-description "${ERROR_MESSAGE}" \
    --attrs "error=true,error_message=${ERROR_MESSAGE},error_code=${ERROR_CODE},container=${HOSTNAME}" \
  
  # Also update the heartbeat file timestamp so health checks know we're still running
  # even with an error
  touch ${STATE_DIR}/heartbeat
}

# Function to check if an environment variable is set
check_env_var() {
  VAR_NAME="$1"
  VAR_DESC="$2"
  
  if [ -z "$(eval echo \$${VAR_NAME})" ]; then
    send_error_span "${VAR_NAME} environment variable is not set! (${VAR_DESC})" "env_var_missing"
    return 1
  fi
  return 0
}

# List of required environment variables with descriptions
ENV_VARS="DATABASE_DIR:Directory_containing_the_database_file
DATABASE_FILENAME:Name_of_the_database_file
BACKUP_DIR:Directory_to_store_backups
BACKUP_SCHEDULE:Schedule_specification_for_backups
BACKUP_RETENTION_DAYS:Number_of_days_to_keep_backups
HEARTBEAT_INTERVAL_SECONDS:Seconds_between_heartbeat_spans
LOG_RETENTION_DAYS:Number_of_days_to_keep_log_files
OTEL_SERVICE_NAME:Service_name_for_telemetry
OTEL_EXPORTER_OTLP_ENDPOINT:Endpoint_for_telemetry"

# Check all required environment variables using ash-compatible method
echo "$ENV_VARS" | while IFS=: read -r var_name var_desc; do
  # Replace underscores with spaces in description for better readability
  var_desc=$(echo "$var_desc" | tr '_' ' ')
  check_env_var "$var_name" "$var_desc" || exit 1
done

# Ensure we exit if any of the environment variables are missing
# This is needed because the 'exit 1' in the while loop only exits the subshell
if [ $? -ne 0 ]; then
  exit 1
fi

# Set derived variables
DATABASE_FILE="${DATABASE_DIR}/${DATABASE_FILENAME}"
PROCESS_ID="backup-$(hostname)-$(date +%Y%m%d%H%M%S)"

# Create directories
mkdir -p ${STATE_DIR}
mkdir -p ${BACKUP_DIR}

# Setup logging
LOG_DIR="${BACKUP_DIR}/logs"
mkdir -p ${LOG_DIR}
LOG_FILE="${LOG_DIR}/backup-$(date +%Y-%m-%d).log"

# Redirect stdout and stderr to both console and log file
exec > >(tee -a "${LOG_FILE}") 2>&1

# Log start of service with important details
echo "===================================="
echo "Backup service started at $(date)"
echo "===================================="
echo "Configuration:"
echo "  - DATABASE_DIR: ${DATABASE_DIR}"
echo "  - DATABASE_FILENAME: ${DATABASE_FILENAME}"
echo "  - DATABASE_FILE: ${DATABASE_FILE}"
echo "  - BACKUP_DIR: ${BACKUP_DIR}"
echo "  - BACKUP_SCHEDULE: ${BACKUP_SCHEDULE}"
echo "  - BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS} days"
echo "  - HEARTBEAT_INTERVAL_SECONDS: ${HEARTBEAT_INTERVAL_SECONDS} seconds"
echo "  - LOG_RETENTION_DAYS: ${LOG_RETENTION_DAYS} days"
echo "  - OTEL_SERVICE_NAME: ${OTEL_SERVICE_NAME}"
echo "  - OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT}"
echo "  - PROCESS_ID: ${PROCESS_ID}"
echo "===================================="

# Wait for the database directory and database file to be available
echo "Checking for database directory and database file..."
MAX_ATTEMPTS=30
ATTEMPT=1
SUCCESS=0

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  if [ -d "${DATABASE_DIR}" ]; then
    echo "Database directory exists: ${DATABASE_DIR}"
    
    if [ -f "${DATABASE_FILE}" ]; then
      echo "Database file exists: ${DATABASE_FILE}"
      
      # Verify it's actually an SQLite database
      if sqlite3 "${DATABASE_FILE}" "PRAGMA integrity_check;" > /dev/null 2>&1; then
        echo "SQLite database verified."
        SUCCESS=1
        break
      else
        echo "Warning: File ${DATABASE_FILE} is not a valid SQLite database."
      fi
    else
      echo "Warning: Database file ${DATABASE_FILE} not found."
    fi
  else
    echo "Warning: Database directory ${DATABASE_DIR} does not exist."
  fi
  
  echo "Attempt $ATTEMPT of $MAX_ATTEMPTS. Waiting 10 seconds before retry..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep 10
done

if [ $SUCCESS -ne 1 ]; then
  send_error_span "Could not find valid database after $MAX_ATTEMPTS attempts." "database_unavailable"
  exit 1
fi

# Create a timestamp file that can be checked for healthcheck
touch ${STATE_DIR}/heartbeat

# Send a heartbeat span to confirm the service is running
send_heartbeat_span() {
  CURRENT_TIME=$(date +%s)
  
  # Get database size if available
  DB_SIZE="unknown"
  if [ -f "${DATABASE_FILE}" ]; then
    DB_SIZE=$(stat -c %s "${DATABASE_FILE}")
  fi
  
  # Get disk space info
  DISK_USAGE=$(df -h ${BACKUP_DIR} | awk 'NR==2 {print $5}')
  
  otel-cli span \
    --service "${OTEL_SERVICE_NAME}" \
    --name "backup_service_heartbeat" \
    --kind internal \
    --attrs "status=running,container=${HOSTNAME},database_file=${DATABASE_FILE},database_dir=${DATABASE_DIR},timestamp=${CURRENT_TIME},database_size_bytes=${DB_SIZE},disk_usage=${DISK_USAGE},process_id=${PROCESS_ID}" \
    --endpoint "${OTEL_EXPORTER_OTLP_ENDPOINT}"
  
  # Update the heartbeat file for healthcheck
  touch ${STATE_DIR}/heartbeat
}

# The backup function
perform_backup() {
  # Generate timestamp for this backup run
  TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/sqlite-${TIMESTAMP}.db"
  JOB_ID="backup-${TIMESTAMP}"

  echo "Starting backup process at $(date) for schedule: $SCHEDULE_SPEC"
  echo "Backup job ID: ${JOB_ID}"

  # Start a parent span for the entire backup process
  otel-cli exec \
    --service ${OTEL_SERVICE_NAME} \
    --name "database_backup_process" \
    --kind internal \
    --attrs "process_id=${PROCESS_ID},job_id=${JOB_ID},schedule=${SCHEDULE_SPEC},database_file=${DATABASE_FILE}" \
    -- sh -c "
    echo \"Parent span: Starting database backup process\"
    
    START_TIME=\$(date +%s)
    
    # Count existing backups before process
    BACKUPS_BEFORE=\$(find ${BACKUP_DIR} -name \"sqlite-*.db\" | wc -l)
    echo \"Found \$BACKUPS_BEFORE existing backups\"
    
    # STEP 1: Create backup (child span)
    otel-cli exec --service ${OTEL_SERVICE_NAME} --name \"backup_creation\" --kind internal -- sh -c \"
      echo \\\"Creating backup: ${BACKUP_FILE}\\\"
      
      if sqlite3 ${DATABASE_FILE} \\\".backup ${BACKUP_FILE}\\\"; then
        # Get backup file size
        FILE_SIZE=\\\$(stat -c %s \\\"${BACKUP_FILE}\\\")
        echo \\\"Backup created successfully. Size: \\\${FILE_SIZE} bytes\\\"
        
        # Add an event to the span with the file size
        otel-cli span event --name \\\"backup_created\\\" --attrs \\\"file_size_bytes=\\\${FILE_SIZE},success=true\\\"
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
      --attrs \"backups_before=\${BACKUPS_BEFORE},retention_days=${BACKUP_RETENTION_DAYS}\" \
      -- sh -c \"
        echo \\\"Cleaning up old backups...\\\"
        
        # Find old backups to delete
        OLD_BACKUPS=\\\$(find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" -type f -mtime +${BACKUP_RETENTION_DAYS} | wc -l)
        echo \\\"Found \\\${OLD_BACKUPS} backups older than ${BACKUP_RETENTION_DAYS} days\\\"
        
        # Delete old backups
        find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" -type f -mtime +${BACKUP_RETENTION_DAYS} -delete
        
        # Count backups after cleanup
        BACKUPS_AFTER=\\\$(find ${BACKUP_DIR} -name \\\"sqlite-*.db\\\" | wc -l)
        
        # Calculate total size of all backups
        TOTAL_SIZE=\\\$(du -sb ${BACKUP_DIR} | cut -f1)
        
        echo \\\"Backup cleanup completed: \\\${OLD_BACKUPS} files deleted\\\"
        echo \\\"Backups: \\\${BACKUPS_BEFORE} before, \\\${BACKUPS_AFTER} after cleanup\\\"
        echo \\\"Total backup size: \\\${TOTAL_SIZE} bytes\\\"
        
        # Add an event with the cleanup details
        otel-cli span event --name \\\"cleanup_completed\\\" --attrs \\\"backups_cleaned=\\\${OLD_BACKUPS},backups_after=\\\${BACKUPS_AFTER},total_size_bytes=\\\${TOTAL_SIZE}\\\"
      \"
    
    # Calculate duration
    END_TIME=\$(date +%s)
    DURATION=\$((END_TIME - START_TIME))
    
    # STEP 3: Create a summary span to capture the overall result
    otel-cli exec --service ${OTEL_SERVICE_NAME} --name \"backup_summary\" --kind internal \
      --attrs \"backup_file=${BACKUP_FILE},file_size_bytes=${FILE_SIZE},success=true,backups_before=${BACKUPS_BEFORE},backups_after=\$(find ${BACKUP_DIR} -name \"sqlite-*.db\" | wc -l),total_backup_size_bytes=\$(du -sb ${BACKUP_DIR} | cut -f1),schedule_spec=${SCHEDULE_SPEC},duration_seconds=\${DURATION},job_id=${JOB_ID}\" \
      -- echo \"Backup process completed successfully at \$(date). Total duration: \${DURATION} seconds\"
  "

  # After successful backup, update the last run time
  echo "$(date +%s)" >"${STATE_DIR}/last_run_${SCHEDULE_HASH}"

  return $?
}

# Simple log rotation mechanism
rotate_logs() {
  echo "Rotating logs older than ${LOG_RETENTION_DAYS} days..."
  
  # Delete logs older than specified retention period
  find ${LOG_DIR} -name "backup-*.log" -type f -mtime +${LOG_RETENTION_DAYS} -delete
  
  # Send a log rotation event to telemetry
  otel-cli span --service ${OTEL_SERVICE_NAME} --name "log_rotation" --kind internal \
    --attrs "action=rotate_logs,log_dir=${LOG_DIR},retention_days=${LOG_RETENTION_DAYS}" \
    --span-event "log_rotation_completed" \
    --message "Rotated backup logs older than ${LOG_RETENTION_DAYS} days"
}

# Send initial heartbeat span
send_heartbeat_span

# Initialize the last heartbeat time
LAST_HEARTBEAT_TIME=$(date +%s)

# Main loop
while true; do
  # Get current time information
  current_time=$(date +%H:%M)
  current_timestamp=$(date +%s)

  # Check if it's time to send a heartbeat span
  time_since_last_heartbeat=$((current_timestamp - LAST_HEARTBEAT_TIME))
  if [ $time_since_last_heartbeat -ge $HEARTBEAT_INTERVAL_SECONDS ]; then
    send_heartbeat_span
    LAST_HEARTBEAT_TIME=$current_timestamp
  fi

  # Call log rotation once per day at midnight
  if [ "$current_time" = "00:00" ]; then
    rotate_logs
  fi

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
        
        # Send a heartbeat span after each backup
        send_heartbeat_span
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
