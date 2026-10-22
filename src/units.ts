export const millisecondsPerSecond = 1_000;
export const secondsPerMinute = 60;
export const minutesPerHour = 60;
export const hoursPerDay = 24;
export const millisecondsPerMinute = secondsPerMinute * millisecondsPerSecond;
export const millisecondsPerHour = minutesPerHour * millisecondsPerMinute;
export const millisecondsPerDay = hoursPerDay * millisecondsPerHour;
export const percentageScale = 100;
export const unixTimestampMillisecondsThreshold = 1_000_000_000_000;

export const bytesPerKibibyte = 1_024;
export const bytesPerMebibyte = bytesPerKibibyte * bytesPerKibibyte;
export const bytesPerGibibyte = bytesPerMebibyte * bytesPerKibibyte;
