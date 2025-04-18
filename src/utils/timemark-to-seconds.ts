export const timemarkToSeconds = (timemark: string) => {
  if (typeof timemark === "number") {
    return timemark;
  }

  if (timemark.indexOf(":") === -1 && timemark.indexOf(".") >= 0) {
    return Number(timemark);
  }

  var parts = timemark.split(":");

  // add seconds
  var secs = Number(parts.pop());

  if (parts.length) {
    // add minutes
    secs += Number(parts.pop()) * 60;
  }

  if (parts.length) {
    // add hours
    secs += Number(parts.pop()) * 3600;
  }

  return secs;
};
