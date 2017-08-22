import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { StaticCircuitChallangerComponent } from './static-circuit-challanger.component';

describe('StaticCircuitChallangerComponent', () => {
  let component: StaticCircuitChallangerComponent;
  let fixture: ComponentFixture<StaticCircuitChallangerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ StaticCircuitChallangerComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(StaticCircuitChallangerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});
