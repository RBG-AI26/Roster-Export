#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <AppKit/AppKit.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "usage: ocr <image-path>\n");
      return 1;
    }

    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
    if (!image) {
      fprintf(stderr, "could not load image\n");
      return 2;
    }

    CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (!cgImage) {
      fprintf(stderr, "could not create cgimage\n");
      return 3;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;

    NSError *error = nil;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    if (![handler performRequests:@[ request ] error:&error]) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 4;
    }

    NSArray<VNRecognizedTextObservation *> *observations = request.results ?: @[];
    for (VNRecognizedTextObservation *observation in observations) {
      VNRecognizedText *text = [[observation topCandidates:1] firstObject];
      if (!text) {
        continue;
      }
      CGRect box = observation.boundingBox;
      printf("%.4f\t%.4f\t%s\n", box.origin.x, box.origin.y, [text.string UTF8String]);
    }
  }

  return 0;
}
