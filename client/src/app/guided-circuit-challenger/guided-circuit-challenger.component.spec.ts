import {async, ComponentFixture, TestBed} from '@angular/core/testing';

import {GuidedCircuitChallengerComponent} from './guided-circuit-challenger.component';

describe('GuidedCircuitChallengerComponent', () => {
  let component: GuidedCircuitChallengerComponent;
  let fixture: ComponentFixture<GuidedCircuitChallengerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [GuidedCircuitChallengerComponent]
    })
      .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GuidedCircuitChallengerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});
